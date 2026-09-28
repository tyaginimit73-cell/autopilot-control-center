import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { loadCredentials, saveCredentials } from "../credentials/store.js";
import { ControlPlaneClient, ControlPlaneError } from "../transport/client.js";
import { SseConnection } from "../transport/events.js";
import { CommandExecutor } from "../executor/index.js";
import { AgentStore } from "../state/store.js";

const TOKEN = "apd_transport_abcdef0123456789abcdef0123456789";
const DEVICE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ENV_KEYS = ["AUTOPILOT_CREDENTIALS_FILE", "CREDENTIAL_BACKEND", "DEVICE_TOKEN", "DEVICE_ID"];
let savedEnv: Record<string, string | undefined> = {};
let tmpRoot = "";

interface Mock {
  server: http.Server;
  url: string;
  authHeaders: string[];
  queryViolations: string[];
  results: unknown[];
}

function startMock(expectedToken: string, command: unknown): Promise<Mock> {
  return new Promise((resolve) => {
    const mock: Mock = { server: null as unknown as http.Server, url: "", authHeaders: [], queryViolations: [], results: [] };
    mock.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://mock");
      if (url.search.includes("token=")) mock.queryViolations.push(url.pathname);
      const authorized = req.headers.authorization === `Bearer ${expectedToken}`;
      if (url.pathname === "/api/agent/events") {
        mock.authHeaders.push(req.headers.authorization ?? "");
        if (!authorized) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: hello\ndata: ${JSON.stringify({ deviceId: DEVICE_ID, protocol: "9.9.9", heartbeatSeconds: 5 })}\n\n`);
        res.write(`event: command\ndata: ${JSON.stringify(command)}\n\n`);
        setTimeout(() => res.end(), 150);
        return;
      }
      if (url.pathname === "/api/agent/heartbeat" && req.method === "POST") {
        mock.authHeaders.push(req.headers.authorization ?? "");
        if (!authorized) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/api/agent/result" && req.method === "POST") {
        mock.authHeaders.push(req.headers.authorization ?? "");
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            mock.results.push(JSON.parse(body));
          } catch {
            /* ignore */
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, matched: true }));
        });
        return;
      }
      if (url.pathname === "/api/agent/leaky-error" && req.method === "POST") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `backend exploded for ${expectedToken} oops` }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    mock.server.listen(0, "127.0.0.1", () => {
      mock.url = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
      resolve(mock);
    });
  });
}

async function stopMock(mock: Mock): Promise<void> {
  mock.server.closeAllConnections();
  await new Promise<void>((resolve) => mock.server.close(() => resolve()));
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-transport-test-"));
  process.env.AUTOPILOT_CREDENTIALS_FILE = path.join(tmpRoot, "credentials.json");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("credential loading → transport", () => {
  it("loads the stored credential, heartbeats, streams SSE and dry-runs a command", async () => {
    const command = { id: "cmd-1", type: "TYPE_TEXT", parameters: { text: "transport-s3cr3t" }, timeoutMs: 5000, dryRun: true };
    const mock = await startMock(TOKEN, command);
    try {
      await saveCredentials({ deviceToken: TOKEN, deviceId: DEVICE_ID, serverUrl: mock.url });
      const creds = await loadCredentials();
      assert.equal(creds?.backend, "file");
      assert.equal(creds?.deviceId, DEVICE_ID);

      const client = new ControlPlaneClient(mock.url, () => creds?.deviceToken ?? null);
      await client.post("/api/agent/heartbeat", { status: "ONLINE" });

      const store = new AgentStore();
      const executor = new CommandExecutor({ client, store, profiles: [], forceDryRun: false, log: () => undefined });
      let helloProtocol = "";
      const events = new SseConnection({
        baseUrl: mock.url,
        getToken: () => creds?.deviceToken ?? null,
        log: () => undefined,
        handlers: {
          onHello: (payload) => {
            helloProtocol = String(payload.protocol ?? "");
          },
          onCommand: (payload) => executor.handle(payload),
          onEmergencyStop: () => undefined,
          onRecorder: () => undefined,
          onStateRequest: () => undefined,
        },
      });
      events.start();
      const deadline = Date.now() + 5_000;
      while (mock.results.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      await events.stop();

      assert.equal(helloProtocol, "9.9.9");
      assert.equal(mock.results.length, 1);
      const result = mock.results[0] as { commandId: string; ok: boolean; message: string };
      assert.equal(result.commandId, "cmd-1");
      assert.equal(result.ok, true);
      assert.ok(!result.message.includes("transport-s3cr3t"), "dry-run result must not echo typed text");
      assert.ok(mock.authHeaders.length >= 3, "heartbeat + SSE + result all authenticated");
      assert.ok(mock.authHeaders.every((header) => header === `Bearer ${TOKEN}`));
      assert.deepEqual(mock.queryViolations, []);
    } finally {
      await stopMock(mock);
    }
  });

  it("redacts the token from server error strings", async () => {
    const mock = await startMock(TOKEN, {});
    try {
      const client = new ControlPlaneClient(mock.url, () => TOKEN);
      await assert.rejects(() => client.post("/api/agent/leaky-error", {}), (error: unknown) => {
        assert.ok(error instanceof ControlPlaneError);
        assert.ok(!(error as Error).message.includes(TOKEN), `token leaked into error: ${(error as Error).message}`);
        assert.match((error as Error).message, /\[redacted\]/);
        return true;
      });
    } finally {
      await stopMock(mock);
    }
  });
});
