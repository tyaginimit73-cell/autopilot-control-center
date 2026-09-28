#!/usr/bin/env node
/**
 * Agent CLI.
 *
 *   node dist/cli.js pair --code PAIR-XXXX-XXXX [--name "My PC"] [--server URL] [--platform win32]
 *   node dist/cli.js save-token --token <token> --device-id <id> [--server URL]
 *
 * Pairing uses the existing POST /api/agent/pair handshake. Credentials are
 * stored in the git-ignored `agent/.env` (DEVICE_TOKEN / DEVICE_ID) and the
 * token is never printed in full.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config, resolveEnvFile } from "./config/index.js";
import { ControlPlaneClient, maskToken } from "./transport/client.js";
import packageJson from "../package.json" with { type: "json" };

const AGENT_VERSION = (packageJson as { version?: string }).version ?? "1.0.0";
/** Phase 1 honestly supports dry-run execution only. */
const PHASE1_CAPABILITIES = ["dry-run"];

function usage(exitCode = 1): never {
  console.error(`AutoPilot agent ${AGENT_VERSION} — CLI

Usage:
  cli.js pair --code <PAIRING_CODE> [--name <device name>] [--server <url>] [--platform <id>]
  cli.js save-token --token <device token> --device-id <id> [--server <url>]

Examples:
  cli.js pair --code PAIR-AB12-CD34 --name "My Windows PC"
  cli.js save-token --token apd_... --device-id 00000000-0000-0000-0000-000000000000

Credentials are written to ${resolveEnvFile()} (git-ignored). The token is never printed.`);
  process.exit(exitCode);
}

function args(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const argv = process.argv.slice(3);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function cleanServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) throw new Error(`--server must start with http(s):// (got "${value}")`);
  return trimmed;
}

/**
 * Merge credentials into agent/.env, preserving every other line. Creates the
 * file when absent. Sets restrictive permissions (0600) on POSIX systems.
 */
export function storeCredentials(file: string, updates: { deviceToken?: string; deviceId?: string; serverUrl?: string }) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing.split("\n");
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match?.[1];
    if (!key) return line;
    if (key === "DEVICE_TOKEN" && updates.deviceToken !== undefined) {
      seen.add(key);
      return `DEVICE_TOKEN=${updates.deviceToken}`;
    }
    if (key === "DEVICE_ID" && updates.deviceId !== undefined) {
      seen.add(key);
      return `DEVICE_ID=${updates.deviceId}`;
    }
    if (key === "SERVER_URL" && updates.serverUrl !== undefined) {
      seen.add(key);
      return `SERVER_URL=${updates.serverUrl}`;
    }
    return line;
  });
  if (updates.deviceToken !== undefined && !seen.has("DEVICE_TOKEN")) next.push(`DEVICE_TOKEN=${updates.deviceToken}`);
  if (updates.deviceId !== undefined && !seen.has("DEVICE_ID")) next.push(`DEVICE_ID=${updates.deviceId}`);
  if (updates.serverUrl !== undefined && !seen.has("SERVER_URL")) next.push(`SERVER_URL=${updates.serverUrl}`);
  const content = next.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, { mode: 0o600 });
  try {
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

export interface PairOptions {
  code: string;
  name?: string;
  server?: string;
  platform?: string;
}

export async function runPair(opts: PairOptions): Promise<{ deviceId: string }> {
  const code = opts.code.trim().toUpperCase();
  if (!code) throw new Error("missing pairing code");
  const serverUrl = cleanServerUrl(opts.server ?? config.serverUrl);
  const deviceName = opts.name?.trim() || os.hostname() || "Windows PC";
  const platform = opts.platform?.trim() || process.platform;
  const client = new ControlPlaneClient(serverUrl, () => null);

  console.log(`[agent] pairing "${deviceName}" with ${serverUrl} …`);
  const result = await client.pair({
    pairingCode: code,
    deviceName,
    platform,
    agentVersion: AGENT_VERSION,
    capabilities: PHASE1_CAPABILITIES,
  });
  storeCredentials(resolveEnvFile(), { deviceToken: result.deviceToken, deviceId: result.deviceId, serverUrl });
  console.log(`[agent] paired: deviceId=${result.deviceId}`);
  console.log(`[agent] token ${maskToken(result.deviceToken)} stored in ${resolveEnvFile()}`);
  console.log("[agent] next: start the agent (npm start) — it will come ONLINE automatically.");
  return { deviceId: result.deviceId };
}

export interface SaveTokenOptions {
  token: string;
  deviceId: string;
  server?: string;
}

export async function runSaveToken(opts: SaveTokenOptions): Promise<void> {
  if (!opts.token.trim() || !opts.deviceId.trim()) throw new Error("missing --token or --device-id");
  storeCredentials(resolveEnvFile(), {
    deviceToken: opts.token.trim(),
    deviceId: opts.deviceId.trim(),
    ...(opts.server ? { serverUrl: cleanServerUrl(opts.server) } : {}),
  });
  console.log(`[agent] token ${maskToken(opts.token)} stored for device ${opts.deviceId.slice(0, 8)}…`);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") usage(0);
  try {
    if (command === "pair") {
      const parsed = args();
      const code = str(parsed.code);
      if (!code) {
        console.error("[agent] missing required flag: --code <PAIRING_CODE>");
        usage();
      }
      await runPair({ code: code as string, name: str(parsed.name), server: str(parsed.server), platform: str(parsed.platform) });
    } else if (command === "save-token") {
      const parsed = args();
      const token = str(parsed.token);
      const deviceId = str(parsed["device-id"]);
      if (!token || !deviceId) {
        console.error("[agent] missing required flags: --token <token> --device-id <id>");
        usage();
      }
      await runSaveToken({ token: token as string, deviceId: deviceId as string, server: str(parsed.server) });
    } else {
      console.error(`[agent] unknown command "${command}"`);
      usage();
    }
  } catch (error) {
    console.error(`[agent] ${command} failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (invokedDirectly) void main();
