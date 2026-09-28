import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { runDoctor } from "../cli.js";
import { saveCredentials } from "../credentials/store.js";

const TOKEN = "apd_mock_0123456789abcdef0123456789abcdef";
const ENV_KEYS = ["AUTOPILOT_CREDENTIALS_FILE", "CREDENTIAL_BACKEND", "DEVICE_TOKEN", "DEVICE_ID"];
let savedEnv: Record<string, string | undefined> = {};
let tmpRoot = "";

interface Mock {
  server: http.Server;
  url: string;
  authHeaders: string[];
  queryViolations: string[];
  heartbeats: number;
}

function startMock(expectedToken: string): Promise<Mock> {
  return new Promise((resolve) => {
    const mock: Mock = { server: null as unknown as http.Server, url: "", authHeaders: [], queryViolations: [], heartbeats: 0 };
    mock.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://mock");
      if (url.search.includes("token=")) mock.queryViolations.push(url.pathname);
      if (url.pathname === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: "9.9.9-mock" }));
        return;
      }
      if (url.pathname === "/api/agent/events") {
        mock.authHeaders.push(req.headers.authorization ?? "");
        if (req.headers.authorization !== `Bearer ${expectedToken}`) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: hello\ndata: ${JSON.stringify({ deviceId: "dev-mock", protocol: "9.9.9", heartbeatSeconds: 5, note: "mock" })}\n\n`);
        return; // held open; the client aborts after hello
      }
      if (url.pathname === "/api/agent/heartbeat" && req.method === "POST") {
        mock.authHeaders.push(req.headers.authorization ?? "");
        if (req.headers.authorization !== `Bearer ${expectedToken}`) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        mock.heartbeats += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-doctor-test-"));
  process.env.AUTOPILOT_CREDENTIALS_FILE = path.join(tmpRoot, "credentials.json");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("doctor", () => {
  it("passes against a healthy control plane without exposing the token", async () => {
    const mock = await startMock(TOKEN);
    try {
      await saveCredentials({ deviceToken: TOKEN, deviceId: "dev-mock", serverUrl: mock.url });
      const lines: string[] = [];
      const { ok, checks } = await runDoctor({}, (line) => lines.push(line));
      assert.equal(ok, true);
      assert.equal(checks.length, 5);
      assert.ok(checks.every((check) => check.ok));
      const output = lines.join("\n");
      assert.match(output, /PASS server reachable/);
      assert.match(output, /PASS SSE endpoint reachable/);
      assert.match(output, /PASS heartbeat accepted/);
      assert.match(output, /9\.9\.9/);
      assert.ok(!output.includes(TOKEN), "doctor output must never contain the token");
      assert.ok(mock.authHeaders.length >= 2, "expected authenticated SSE + heartbeat calls");
      assert.ok(mock.authHeaders.every((header) => header === `Bearer ${TOKEN}`), "auth must be a Bearer header");
      assert.deepEqual(mock.queryViolations, []);
      assert.equal(mock.heartbeats, 1);
    } finally {
      await stopMock(mock);
    }
  });

  it("fails safely with a rejected credential", async () => {
    const mock = await startMock("apd_mock_different_token_value_here_1");
    try {
      await saveCredentials({ deviceToken: TOKEN, deviceId: "dev-mock", serverUrl: mock.url });
      const lines: string[] = [];
      const { ok } = await runDoctor({}, (line) => lines.push(line));
      assert.equal(ok, false);
      const output = lines.join("\n");
      assert.match(output, /FAIL SSE endpoint reachable/);
      assert.match(output, /403/);
      assert.ok(!output.includes(TOKEN), "failure output must never contain the token");
    } finally {
      await stopMock(mock);
    }
  });

  it("fails clearly with no credential and an unreachable server", async () => {
    const lines: string[] = [];
    const { ok } = await runDoctor({ server: "http://127.0.0.1:1" }, (line) => lines.push(line));
    assert.equal(ok, false);
    const output = lines.join("\n");
    assert.match(output, /FAIL server reachable/);
    assert.match(output, /no credential/);
  });
});
