#!/usr/bin/env node
/**
 * AutoPilot Windows agent — Phase 1 entrypoint.
 *
 * DRY-RUN ONLY: this agent connects, pairs, heartbeats, receives commands and
 * reports honest dry-run results. It contains no mouse/keyboard/window/browser
 * drivers, so a physical effect is impossible by construction.
 *
 *   npm run dev          # tsx watch (development)
 *   npm start            # node dist/index.js (production)
 *   npm start -- --pair <CODE>   # one-shot pairing, then exit (see cli.ts)
 */
import { config } from "./config/index.js";
import { AgentStore } from "./state/store.js";
import { CommandExecutor } from "./executor/index.js";
import { ControlPlaneClient } from "./transport/client.js";
import { Reporter } from "./transport/reporter.js";
import { SseConnection } from "./transport/events.js";

const log = (message: string) => console.log(message);

function fail(message: string): never {
  console.error(`[agent] ${message}`);
  process.exit(1);
}

/** Compatibility shim for the documented `npm start -- --pair <CODE>` flow. */
async function maybePairAndExit(): Promise<boolean> {
  const argv = process.argv.slice(2);
  const flag = argv.findIndex((a) => a === "--pair" || a === "--code");
  if (flag === -1) return false;
  const code = argv[flag + 1];
  if (!code || code.startsWith("--")) fail("usage: npm start -- --pair <PAIRING_CODE>");
  const nameFlag = argv.findIndex((a) => a === "--name");
  const name = nameFlag !== -1 && argv[nameFlag + 1] && !argv[nameFlag + 1].startsWith("--") ? argv[nameFlag + 1] : undefined;
  const serverFlag = argv.findIndex((a) => a === "--server");
  const server = serverFlag !== -1 && argv[serverFlag + 1] && !argv[serverFlag + 1].startsWith("--") ? argv[serverFlag + 1] : undefined;
  const { runPair } = await import("./cli.js");
  try {
    await runPair({ code, name, server });
  } catch (error) {
    fail(`pairing failed: ${(error as Error).message}`);
  }
  process.exit(0);
}

async function main() {
  if (await maybePairAndExit()) return;

  const token = config.deviceToken;
  const deviceId = config.deviceId;
  if (!token || !deviceId) {
    fail(
      "DEVICE_TOKEN / DEVICE_ID are not configured.\n" +
        "Pair this machine first:\n" +
        "  npm run pair -- --code <PAIRING_CODE> --name \"My Windows PC\"\n" +
        "Get the code from Devices → Add device in the Control Center.",
    );
  }

  log(`[agent] starting (phase-1 dry-run) → ${config.serverUrl} · device=${deviceId.slice(0, 8)}… · DRY_RUN=${config.dryRun ? "1" : "0"}`);
  if (config.applicationProfiles.length) {
    log(`[agent] local application profiles: ${config.applicationProfiles.length} configured`);
  } else {
    log("[agent] local application profiles: none (OPEN_APPLICATION will be rejected)");
  }

  const store = new AgentStore();
  const client = new ControlPlaneClient(config.serverUrl, () => config.deviceToken);
  const executor = new CommandExecutor({ client, store, profiles: config.applicationProfiles, forceDryRun: config.dryRun, log });
  const reporter = new Reporter({ client, store, heartbeatMs: config.heartbeatMs, stateMs: config.stateReportMs, log });
  const events = new SseConnection({
    baseUrl: config.serverUrl,
    getToken: () => config.deviceToken,
    log,
    handlers: {
      onHello: (payload) => {
        store.onHello({
          deviceId: String(payload.deviceId ?? deviceId),
          protocol: String(payload.protocol ?? "unknown"),
          heartbeatSeconds: Number(payload.heartbeatSeconds ?? config.heartbeatMs / 1000),
          receivedAt: new Date().toISOString(),
        });
        store.stats.reconnects += store.connectedAt ? 0 : 0;
        log(`[agent] connected: ${String(payload.note ?? "command stream open")} (protocol ${String(payload.protocol ?? "?")})`);
      },
      onCommand: (payload) => executor.handle(payload),
      onEmergencyStop: (payload) => {
        const reason = typeof payload.at === "number" ? `server signal @ ${new Date(payload.at).toISOString()}` : "server signal";
        executor.emergencyStop(reason);
      },
      onRecorder: (active) => {
        log(`[agent] recorder:${active ? "start" : "stop"} received — input hooks are not implemented in Phase 1 (ignored)`);
      },
      onStateRequest: () => reporter.pushStateNow(),
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[agent] ${signal} received — shutting down…`);
    await events.stop().catch(() => undefined);
    reporter.stop();
    const snapshot = store.snapshot();
    log(
      `[agent] stopped. commands: received=${snapshot.stats.commandsReceived} completed=${snapshot.stats.commandsCompleted} ` +
        `rejected=${snapshot.stats.commandsRejected} duplicates=${snapshot.stats.duplicatesIgnored} emergencyStops=${snapshot.stats.emergencyStops}`,
    );
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (error) => {
    console.error(`[agent] unhandled rejection: ${(error as Error)?.message ?? error}`);
    void shutdown("ERROR");
  });

  reporter.start();
  events.start();
}

void main();
