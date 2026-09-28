/**
 * Agent credential storage (Phase 2).
 *
 * Precedence for the device credential:
 *
 *   secure store (file, or OS keychain when explicitly enabled)
 *     → environment (DEVICE_TOKEN / DEVICE_ID, legacy .env compatible)
 *     → none (startup fails with a pairing hint)
 *
 * Backends:
 *  - `file` (default): JSON at ~/.autopilot-agent/credentials.json, outside any
 *    Git checkout, 0700 directory + 0600 file on POSIX, atomic writes. The token
 *    is never printed, never logged, and never embedded in URLs.
 *  - `keychain` (opt-in via CREDENTIAL_BACKEND=keychain): the OS credential
 *    store through an optionally-installed `keytar` (Windows Credential
 *    Manager / macOS Keychain / libsecret). keytar is deliberately NOT a
 *    dependency — native builds cannot be verified from every machine — so the
 *    backend activates only when the module is present and working.
 *
 * Test escape hatch: AUTOPILOT_CREDENTIALS_FILE redirects the file backend.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface StoredCredentials {
  deviceToken: string;
  deviceId: string;
  serverUrl?: string;
  savedAt?: string;
}

export type CredentialBackendName = "file" | "keychain" | "env";

export interface CredentialStore {
  readonly backend: Exclude<CredentialBackendName, "env">;
  /** Human-readable location. Safe to log — never contains secret material. */
  readonly location: string;
  load(): Promise<StoredCredentials | null>;
  save(creds: StoredCredentials): Promise<void>;
  clear(): Promise<void>;
}

/** agent/.env path (legacy location; kept for SERVER_URL + env fallback). */
export function resolveEnvFile(): string {
  return path.join(process.cwd(), ".env");
}

export function defaultCredentialsFile(): string {
  const override = process.env.AUTOPILOT_CREDENTIALS_FILE?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".autopilot-agent", "credentials.json");
}

function validCredentials(value: unknown): StoredCredentials | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.deviceToken !== "string" || !record.deviceToken.trim()) return null;
  if (typeof record.deviceId !== "string" || !record.deviceId.trim()) return null;
  return {
    deviceToken: record.deviceToken,
    deviceId: record.deviceId,
    ...(typeof record.serverUrl === "string" && record.serverUrl ? { serverUrl: record.serverUrl } : {}),
    ...(typeof record.savedAt === "string" ? { savedAt: record.savedAt } : {}),
  };
}

export class FileCredentialStore implements CredentialStore {
  readonly backend = "file" as const;
  constructor(readonly file: string = defaultCredentialsFile()) {}

  get location(): string {
    return this.file;
  }

  async load(): Promise<StoredCredentials | null> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.file, "utf8");
    } catch {
      return null;
    }
    try {
      return validCredentials(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(creds: StoredCredentials): Promise<void> {
    const dir = path.dirname(this.file);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      try {
        await fs.promises.chmod(dir, 0o700);
      } catch {
        /* best effort */
      }
    }
    const payload = `${JSON.stringify({ ...creds, savedAt: new Date().toISOString() }, null, 2)}\n`;
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, payload, { mode: 0o600 });
    if (process.platform !== "win32") {
      try {
        await fs.promises.chmod(tmp, 0o600);
      } catch {
        /* best effort */
      }
    }
    await fs.promises.rename(tmp, this.file);
  }

  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.file);
    } catch {
      /* already absent */
    }
  }
}

/** Minimal keytar surface. The real module is required dynamically, never bundled. */
export interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

type KeytarLoader = () => KeytarLike | null;
let keytarLoader: KeytarLoader | null = null;

/** Test seam: inject a fake keytar module. Never used in production code paths. */
export function __setKeytarLoaderForTests(loader: KeytarLoader | null): void {
  keytarLoader = loader;
}

function loadKeytar(): KeytarLike | null {
  if (keytarLoader) return keytarLoader();
  try {
    const require = createRequire(import.meta.url);
    const mod = require("keytar") as Partial<KeytarLike>;
    if (typeof mod?.getPassword !== "function" || typeof mod?.setPassword !== "function") return null;
    return mod as KeytarLike;
  } catch {
    return null;
  }
}

export class KeychainCredentialStore implements CredentialStore {
  readonly backend = "keychain" as const;
  private readonly keytar: KeytarLike | null;

  constructor(keytar: KeytarLike | null = loadKeytar(), private readonly service = "autopilot-agent", private readonly account = "device") {
    this.keytar = keytar;
  }

  get available(): boolean {
    return this.keytar !== null;
  }

  get location(): string {
    return `${this.service}/${this.account} (OS credential store)`;
  }

  async load(): Promise<StoredCredentials | null> {
    if (!this.keytar) return null;
    try {
      const raw = await this.keytar.getPassword(this.service, this.account);
      if (!raw) return null;
      return validCredentials(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(creds: StoredCredentials): Promise<void> {
    if (!this.keytar) {
      throw new Error("OS keychain unavailable — install keytar (`npm i keytar`) or use CREDENTIAL_BACKEND=file");
    }
    await this.keytar.setPassword(this.service, this.account, JSON.stringify({ ...creds, savedAt: new Date().toISOString() }));
  }

  async clear(): Promise<void> {
    try {
      await this.keytar?.deletePassword(this.service, this.account);
    } catch {
      /* already absent */
    }
  }
}

/** Which secure backend is active. `file` unless CREDENTIAL_BACKEND=keychain. */
export function resolveCredentialStore(): CredentialStore {
  const requested = (process.env.CREDENTIAL_BACKEND ?? "file").trim().toLowerCase();
  if (requested === "keychain") {
    const store = new KeychainCredentialStore();
    if (!store.available) {
      throw new Error("CREDENTIAL_BACKEND=keychain but no OS keychain is available (keytar not installed or no secret service running)");
    }
    return store;
  }
  if (requested !== "file") throw new Error(`Unknown CREDENTIAL_BACKEND "${process.env.CREDENTIAL_BACKEND}" (expected "file" or "keychain")`);
  return new FileCredentialStore();
}

export interface LoadedCredentials extends StoredCredentials {
  backend: CredentialBackendName;
}

/**
 * Load the device credential: secure store first, explicit environment
 * configuration (DEVICE_TOKEN / DEVICE_ID, .env included) second.
 */
export async function loadCredentials(): Promise<LoadedCredentials | null> {
  const store = resolveCredentialStore();
  const stored = await store.load().catch(() => null);
  if (stored) return { ...stored, backend: store.backend };
  const deviceToken = process.env.DEVICE_TOKEN?.trim() || null;
  const deviceId = process.env.DEVICE_ID?.trim() || null;
  if (deviceToken && deviceId) return { deviceToken, deviceId, backend: "env" };
  return null;
}

/**
 * Persist credentials to the active secure store and remove any plaintext
 * DEVICE_TOKEN / DEVICE_ID lines from agent/.env so a stale copy can never
 * shadow the secure store or leak from the checkout.
 */
export async function saveCredentials(creds: StoredCredentials): Promise<CredentialStore> {
  const store = resolveCredentialStore();
  await store.save(creds);
  stripEnvCredentials(resolveEnvFile());
  return store;
}

/** Remove plaintext credential lines from a .env file. Returns true when edited. */
export function stripEnvCredentials(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const kept = lines.filter((line) => !/^\s*DEVICE_(TOKEN|ID)\s*=/.test(line));
  if (kept.length === lines.length) return false;
  fs.writeFileSync(file, kept.join("\n"));
  return true;
}

/** Pairing-code shape, mirroring shared PAIRING_CODE_PATTERN (agent has no shared dep). */
const PAIRING_CODE_PATTERN = /^PAIR-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Normalize + validate before any network call. The error never echoes the input. */
export function normalizePairingCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!PAIRING_CODE_PATTERN.test(code)) {
    throw new Error(`Invalid pairing code (expected PAIR-XXXX-XXXX, got ${maskPairingCode(raw)})`);
  }
  return code;
}

/** Mask a pairing code for logs: last block only, e.g. `PAIR-••••-AE6V`. */
export function maskPairingCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9-]{9,}$/.test(code)) return "PAIR-••••-••••";
  return `PAIR-••••-${code.slice(-4)}`;
}
