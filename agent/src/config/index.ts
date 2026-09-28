import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { loadCredentials, resolveCredentialStore } from "../credentials/store.js";

/** Legacy .env path (re-exported; defined alongside the credential helpers). */
export { resolveEnvFile } from "../credentials/store.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export interface AgentConfig {
  serverUrl: string;
  deviceToken: string | null;
  deviceId: string | null;
  dryRun: boolean;
  heartbeatMs: number;
  pointerReportMs: number;
  stateReportMs: number;
  headless: boolean;
  cdpUrl: string | null;
  browserExecutablePath: string | null;
  emergencyShortcut: string;
  drivers: { mouse: string; keyboard: string; windows: string };
  recorder: { enabled: boolean; keyboard: boolean; mask: boolean };
  applicationProfiles: ApplicationProfile[];
}

export interface ApplicationProfile {
  id: string;
  name: string;
  executablePath: string;
  arguments: string[];
  enabled: boolean;
}

function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Extra, local-only safety layer: the agent keeps its own allowlist of launchable
 * applications. Even a fully compromised control plane cannot start a binary that
 * this machine has not been explicitly configured for.
 */
function loadLocalProfiles(): ApplicationProfile[] {
  const file = path.join(process.cwd(), "applications.json");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ApplicationProfile[];
    return raw.filter((profile) => profile && typeof profile.executablePath === "string" && profile.enabled !== false);
  } catch (error) {
    console.warn("[agent] applications.json is not readable:", (error as Error).message);
    return [];
  }
}

export function cleanServerUrl(value: string | undefined): string {
  const trimmed = (value ?? "http://localhost:3000").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`SERVER_URL must start with http(s):// (got "${value ?? ""}")`);
  }
  return trimmed;
}

export const config: AgentConfig = {
  serverUrl: cleanServerUrl(process.env.SERVER_URL),
  deviceToken: process.env.DEVICE_TOKEN || null,
  deviceId: process.env.DEVICE_ID || null,
  dryRun: bool(process.env.DRY_RUN, false),
  heartbeatMs: num(process.env.HEARTBEAT_MS, 5000),
  pointerReportMs: num(process.env.POINTER_REPORT_MS, 250),
  stateReportMs: num(process.env.STATE_REPORT_MS, 4000),
  headless: bool(process.env.HEADLESS, false),
  cdpUrl: process.env.BROWSER_CDP_URL || null,
  browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || null,
  emergencyShortcut: process.env.EMERGENCY_SHORTCUT || "Ctrl+Shift+Esc",
  drivers: {
    mouse: (process.env.MOUSE_DRIVER ?? "auto").toLowerCase(),
    keyboard: (process.env.KEYBOARD_DRIVER ?? "auto").toLowerCase(),
    windows: (process.env.WINDOW_DRIVER ?? "auto").toLowerCase(),
  },
  recorder: {
    enabled: bool(process.env.RECORDER_ENABLED, true),
    keyboard: bool(process.env.RECORDER_KEYBOARD, true),
    mask: bool(process.env.RECORDER_MASK, true),
  },
  applicationProfiles: loadLocalProfiles(),
};

export interface RuntimeConfig {
  serverUrl: string;
  deviceToken: string | null;
  deviceId: string | null;
  credentialBackend: "file" | "keychain" | "env" | null;
  credentialLocation: string;
}

/**
 * Effective runtime configuration. Precedence:
 *
 *   server:  CLI --server → stored credential → SERVER_URL env → http://localhost:3000
 *   token:   secure store (file/keychain) → DEVICE_TOKEN/DEVICE_ID env → none
 *
 * There is deliberately no --token CLI flag: a token on the command line would
 * leak into shell history and process listings. Use `save-token` once, then the
 * secure store owns the credential.
 */
export async function loadRuntimeConfig(overrides: { serverUrl?: string } = {}): Promise<RuntimeConfig> {
  const creds = await loadCredentials();
  const serverUrl = cleanServerUrl(overrides.serverUrl ?? creds?.serverUrl ?? process.env.SERVER_URL);
  let credentialLocation = "environment (DEVICE_TOKEN / DEVICE_ID)";
  if (creds && creds.backend !== "env") {
    try {
      credentialLocation = `${creds.backend} (${resolveCredentialStore().location})`;
    } catch {
      credentialLocation = creds.backend;
    }
  }
  return {
    serverUrl,
    deviceToken: creds?.deviceToken ?? null,
    deviceId: creds?.deviceId ?? null,
    credentialBackend: creds?.backend ?? null,
    credentialLocation,
  };
}
