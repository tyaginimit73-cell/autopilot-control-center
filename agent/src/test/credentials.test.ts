import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FileCredentialStore,
  KeychainCredentialStore,
  __setKeytarLoaderForTests,
  loadCredentials,
  resolveCredentialStore,
  saveCredentials,
  stripEnvCredentials,
} from "../credentials/store.js";

const ENV_KEYS = ["AUTOPILOT_CREDENTIALS_FILE", "CREDENTIAL_BACKEND", "DEVICE_TOKEN", "DEVICE_ID"];
let savedEnv: Record<string, string | undefined> = {};
let tmpRoot = "";

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-creds-test-"));
  process.env.AUTOPILOT_CREDENTIALS_FILE = path.join(tmpRoot, "nested", "credentials.json");
  __setKeytarLoaderForTests(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  __setKeytarLoaderForTests(null);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const CREDS = { deviceToken: "apd_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", deviceId: "11111111-2222-3333-4444-555555555555" };

describe("FileCredentialStore", () => {
  it("round-trips credentials, creating parent dirs", async () => {
    const store = new FileCredentialStore();
    assert.equal(await store.load(), null);
    await store.save({ ...CREDS, serverUrl: "http://127.0.0.1:3000" });
    const loaded = await store.load();
    assert.equal(loaded?.deviceToken, CREDS.deviceToken);
    assert.equal(loaded?.deviceId, CREDS.deviceId);
    assert.equal(loaded?.serverUrl, "http://127.0.0.1:3000");
    assert.ok(loaded?.savedAt);
  });

  it("uses restrictive permissions and leaves no temp files", { skip: process.platform === "win32" }, async () => {
    const store = new FileCredentialStore();
    await store.save(CREDS);
    const fileMode = fs.statSync(process.env.AUTOPILOT_CREDENTIALS_FILE as string).mode & 0o777;
    assert.equal(fileMode.toString(8), "600");
    const dirMode = fs.statSync(path.dirname(process.env.AUTOPILOT_CREDENTIALS_FILE as string)).mode & 0o777;
    assert.equal(dirMode.toString(8), "700");
    assert.deepEqual(
      fs.readdirSync(path.dirname(process.env.AUTOPILOT_CREDENTIALS_FILE as string)),
      ["credentials.json"],
    );
  });

  it("returns null for corrupt or incomplete files", async () => {
    const file = process.env.AUTOPILOT_CREDENTIALS_FILE as string;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not-json{{{");
    assert.equal(await new FileCredentialStore().load(), null);
    fs.writeFileSync(file, JSON.stringify({ deviceToken: "x" }));
    assert.equal(await new FileCredentialStore().load(), null);
  });

  it("clear() removes the file", async () => {
    const store = new FileCredentialStore();
    await store.save(CREDS);
    await store.clear();
    assert.equal(await store.load(), null);
    await store.clear(); // idempotent
  });
});

describe("loadCredentials precedence", () => {
  it("prefers the secure store over the environment", async () => {
    await saveCredentials(CREDS);
    process.env.DEVICE_TOKEN = "apd_env_should_lose";
    process.env.DEVICE_ID = "env-device";
    const loaded = await loadCredentials();
    assert.equal(loaded?.deviceToken, CREDS.deviceToken);
    assert.equal(loaded?.backend, "file");
  });

  it("falls back to explicit environment configuration", async () => {
    process.env.DEVICE_TOKEN = "apd_env_token";
    process.env.DEVICE_ID = "env-device";
    const loaded = await loadCredentials();
    assert.equal(loaded?.deviceToken, "apd_env_token");
    assert.equal(loaded?.backend, "env");
  });

  it("returns null when nothing is configured", async () => {
    assert.equal(await loadCredentials(), null);
  });
});

describe("resolveCredentialStore", () => {
  it("defaults to the file backend", () => {
    assert.equal(resolveCredentialStore().backend, "file");
  });

  it("rejects unknown backends", () => {
    process.env.CREDENTIAL_BACKEND = "vault";
    assert.throws(() => resolveCredentialStore(), /Unknown CREDENTIAL_BACKEND/);
  });

  it("fails clearly when keychain is requested but unavailable", () => {
    process.env.CREDENTIAL_BACKEND = "keychain";
    __setKeytarLoaderForTests(() => null);
    assert.throws(() => resolveCredentialStore(), /no OS keychain is available/);
  });
});

describe("KeychainCredentialStore (fake keytar)", () => {
  function fakeKeytar() {
    const map = new Map<string, string>();
    return {
      getPassword: async (service: string, account: string) => map.get(`${service}/${account}`) ?? null,
      setPassword: async (service: string, account: string, password: string) => {
        map.set(`${service}/${account}`, password);
      },
      deletePassword: async (service: string, account: string) => map.delete(`${service}/${account}`),
    };
  }

  it("round-trips through the injected keytar module", async () => {
    __setKeytarLoaderForTests(fakeKeytar);
    process.env.CREDENTIAL_BACKEND = "keychain";
    const store = resolveCredentialStore();
    assert.equal(store.backend, "keychain");
    assert.equal(await store.load(), null);
    await store.save(CREDS);
    const loaded = await store.load();
    assert.equal(loaded?.deviceToken, CREDS.deviceToken);
    assert.equal(loaded?.deviceId, CREDS.deviceId);
    await store.clear();
    assert.equal(await store.load(), null);
  });

  it("loads null and saves loudly when keytar throws", async () => {
    const failing = {
      getPassword: async () => {
        throw new Error("no secret service");
      },
      setPassword: async () => {
        throw new Error("no secret service");
      },
      deletePassword: async () => false,
    };
    const store = new KeychainCredentialStore(failing);
    assert.equal(store.available, true);
    assert.equal(await store.load(), null);
    await assert.rejects(() => store.save(CREDS), /no secret service/);
  });
});

describe("stripEnvCredentials", () => {
  it("removes plaintext credential lines but keeps the rest", () => {
    const file = path.join(tmpRoot, ".env");
    fs.writeFileSync(file, "SERVER_URL=http://x\nDEVICE_TOKEN=apd_zzz\nDEVICE_ID=abc\nDRY_RUN=0\n");
    assert.equal(stripEnvCredentials(file), true);
    const kept = fs.readFileSync(file, "utf8");
    assert.ok(!kept.includes("DEVICE_TOKEN"));
    assert.ok(!kept.includes("DEVICE_ID"));
    assert.ok(kept.includes("SERVER_URL=http://x"));
    assert.ok(kept.includes("DRY_RUN=0"));
    assert.equal(stripEnvCredentials(file), false);
  });
});
