#!/usr/bin/env node
/**
 * Agent CLI.
 *
 *   node dist/cli.js pair --code PAIR-XXXX-XXXX [--name "My PC"] [--server URL] [--platform win32]
 *   node dist/cli.js save-token --token <token> --device-id <id> [--server URL]
 *   node dist/cli.js doctor [--server URL]
 *
 * Pairing uses the existing POST /api/agent/pair handshake. Credentials are
 * stored in the secure credential store (0600 file outside Git by default, OS
 * keychain when CREDENTIAL_BACKEND=keychain). Tokens and pairing codes are
 * never printed — masked output only.
 */
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config, loadRuntimeConfig } from "./config/index.js";
import {
  defaultCredentialsFile,
  maskPairingCode,
  normalizePairingCode,
  saveCredentials,
} from "./credentials/store.js";
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
  cli.js doctor [--server <url>]

Examples:
  cli.js pair --code PAIR-AB12-CD34 --name "My Windows PC"
  cli.js save-token --token apd_... --device-id 00000000-0000-0000-0000-000000000000
  cli.js doctor

Credentials are stored in ${defaultCredentialsFile()} (0600, outside Git),
or the OS keychain when CREDENTIAL_BACKEND=keychain. Secrets are never printed.`);
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

export interface PairOptions {
  code: string;
  name?: string;
  server?: string;
  platform?: string;
}

export async function runPair(opts: PairOptions): Promise<{ deviceId: string }> {
  const code = normalizePairingCode(opts.code);
  const serverUrl = cleanServerUrl(opts.server ?? config.serverUrl);
  const deviceName = opts.name?.trim() || os.hostname() || "Windows PC";
  const platform = opts.platform?.trim() || process.platform;
  const client = new ControlPlaneClient(serverUrl, () => null);

  console.log(`[agent] pairing "${deviceName}" with ${serverUrl} (code ${maskPairingCode(code)}) …`);
  const result = await client.pair({
    pairingCode: code,
    deviceName,
    platform,
    agentVersion: AGENT_VERSION,
    capabilities: PHASE1_CAPABILITIES,
  });
  const store = await saveCredentials({ deviceToken: result.deviceToken, deviceId: result.deviceId, serverUrl });
  console.log(`[agent] paired: deviceId=${result.deviceId}`);
  console.log(`[agent] token ${maskToken(result.deviceToken)} stored via ${store.backend} (${store.location})`);
  console.log("[agent] next: start the agent (npm start) — it will come ONLINE automatically.");
  return { deviceId: result.deviceId };
}

export interface SaveTokenOptions {
  token: string;
  deviceId: string;
  server?: string;
}

export async function runSaveToken(opts: SaveTokenOptions): Promise<void> {
  const token = opts.token.trim();
  const deviceId = opts.deviceId.trim();
  if (!token || !deviceId) throw new Error("missing --token or --device-id");
  const store = await saveCredentials({
    deviceToken: token,
    deviceId,
    ...(opts.server ? { serverUrl: cleanServerUrl(opts.server) } : {}),
  });
  console.log(`[agent] token ${maskToken(token)} stored for device ${deviceId.slice(0, 8)}… via ${store.backend} (${store.location})`);
  console.log("[agent] next: restart the agent, then run `npm run doctor` to verify the new credential.");
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  server?: string;
}

async function fetchHealth(serverUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl}/api/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { version?: unknown };
    return typeof body.version === "string" ? `control-center ${body.version}` : "control-center";
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`timed out after ${timeoutMs}ms`);
    throw new Error((error as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

/** Open the SSE stream just long enough to read the hello frame, then close it. */
async function fetchSseHello(serverUrl: string, token: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl}/api/agent/events`, {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) throw new Error("stream closed before hello");
        buffer += decoder.decode(value, { stream: true });
        const end = buffer.indexOf("\n\n");
        if (end === -1) {
          if (buffer.length > 64_000) throw new Error("no hello frame received");
          continue;
        }
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (frame.includes("event: hello") && dataLine) {
          const payload = JSON.parse(dataLine.slice(5).trim()) as { protocol?: unknown };
          return String(payload.protocol ?? "unknown");
        }
      }
    } finally {
      controller.abort();
      reader.releaseLock();
      await res.body.cancel().catch(() => undefined);
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function runDoctor(opts: DoctorOptions = {}, print: (line: string) => void = console.log): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const runtime = await loadRuntimeConfig({ serverUrl: opts.server });
  const checks: DoctorCheck[] = [];
  print(`[doctor] agent ${AGENT_VERSION} → ${runtime.serverUrl}`);

  try {
    const who = await fetchHealth(runtime.serverUrl, 8_000);
    checks.push({ name: "server reachable", ok: true, detail: `GET /api/health → ${who}` });
  } catch (error) {
    checks.push({ name: "server reachable", ok: false, detail: (error as Error).message });
  }

  if (runtime.deviceToken) {
    checks.push({ name: "authentication configured", ok: true, detail: `token present (${runtime.credentialLocation})` });
  } else {
    checks.push({ name: "authentication configured", ok: false, detail: `no credential stored (${runtime.credentialLocation}) — run pair first` });
  }
  checks.push(
    runtime.deviceId
      ? { name: "device ID configured", ok: true, detail: runtime.deviceId }
      : { name: "device ID configured", ok: false, detail: "missing — run pair first" },
  );

  if (runtime.deviceToken) {
    try {
      const protocol = await fetchSseHello(runtime.serverUrl, runtime.deviceToken, 10_000);
      checks.push({ name: "SSE endpoint reachable", ok: true, detail: `hello received (protocol ${protocol})` });
    } catch (error) {
      checks.push({ name: "SSE endpoint reachable", ok: false, detail: (error as Error).message });
    }
    try {
      const client = new ControlPlaneClient(runtime.serverUrl, () => runtime.deviceToken);
      await client.post("/api/agent/heartbeat", { status: "ONLINE" }, 8_000);
      checks.push({ name: "heartbeat accepted", ok: true, detail: "POST /api/agent/heartbeat → ok" });
    } catch (error) {
      checks.push({ name: "heartbeat accepted", ok: false, detail: (error as Error).message });
    }
  } else {
    checks.push({ name: "SSE endpoint reachable", ok: false, detail: "skipped: no credential" });
    checks.push({ name: "heartbeat accepted", ok: false, detail: "skipped: no credential" });
  }

  for (const check of checks) print(`[doctor] ${check.ok ? "PASS" : "FAIL"} ${check.name} — ${check.detail}`);
  const ok = checks.every((check) => check.ok);
  print(`[doctor] ${ok ? "all checks passed" : "one or more checks failed"}`);
  return { ok, checks };
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
    } else if (command === "doctor") {
      const parsed = args();
      const { ok } = await runDoctor({ server: str(parsed.server) });
      process.exit(ok ? 0 : 1);
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
