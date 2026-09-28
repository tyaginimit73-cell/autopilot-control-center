#!/usr/bin/env node
/**
 * AutoPilot Windows agent — Phase 3 entrypoint.
 *
 * This agent connects, pairs, heartbeats, receives commands and reports honest
 * results. `dryRun: true` commands are simulated only (physical effects
 * impossible by construction — the dry-run path never touches the drivers).
 * `dryRun: false` mouse/keyboard commands execute REAL desktop input through
 * the driver layer (`./drivers`) on a supported Windows agent.
 *
 *   npm run dev          # tsx watch (development)
 *   npm start            # node dist/index.js (production)
 *   npm start -- --pair <CODE>   # one-shot pairing, then exit (see cli.ts)
 *
 * Credentials resolve via loadRuntimeConfig: secure store → environment.
 */
import { config, loadRuntimeConfig } from "./config/index.js";
import { createDrivers, releaseAllDrivers } from "./drivers/index.js";
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

function cliFlag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const at = argv.findIndex((a) => a === name);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  if (await maybePairAndExit()) return;

  const runtime = await loadRuntimeConfig({ serverUrl: cliFlag("--server") });
  const token = runtime.deviceToken;
  const deviceId = runtime.deviceId;
  if (!token || !deviceId) {
    fail(
      `No device credential found (${runtime.credentialLocation}).\n` +
        "Pair this machine first:\n" +
        '  npm run pair -- --code <PAIRING_CODE> --name "My Windows PC"\n' +
        "Get the code from Devices → Add device in the Control Center.",
    );
  }

  const drivers = createDrivers({ mouse: config.drivers.mouse, keyboard: config.drivers.keyboard });
  log(`[agent] starting (phase-3 input) → ${runtime.serverUrl} · device=${deviceId.slice(0, 8)}… · DRY_RUN=${config.dryRun ? "1" : "0"} · creds=${runtime.credentialBackend} · input=${drivers.describe()}`);
  if (config.applicationProfiles.length) {
    log(`[agent] local application profiles: ${config.applicationProfiles.length} configured`);
  } else {
    log("[agent] local application profiles: none (OPEN_APPLICATION will be rejected)");
  }

  const store = new AgentStore();
  const client = new ControlPlaneClient(runtime.serverUrl, () => token);
  const executor = new CommandExecutor({ client, store, profiles: config.applicationProfiles, forceDryRun: config.dryRun, drivers, log });
  const reporter = new Reporter({ client, store, heartbeatMs: config.heartbeatMs, stateMs: config.stateReportMs, log });
  const events = new SseConnection({
    baseUrl: runtime.serverUrl,
    getToken: () => token,
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
    releaseAllDrivers(drivers);
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
