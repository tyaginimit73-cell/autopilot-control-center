import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CommandExecutor, type AgentCommandResult } from "../executor/index.js";
import { AgentStore } from "../state/store.js";
import type { ControlPlaneClient } from "../transport/client.js";

function harness(forceDryRun = false) {
  const posted: { path: string; body: AgentCommandResult }[] = [];
  const fake = {
    post: async (path: string, body: AgentCommandResult) => {
      posted.push({ path, body });
      return { ok: true };
    },
  } as unknown as ControlPlaneClient;
  const store = new AgentStore();
  const executor = new CommandExecutor({ client: fake, store, profiles: [], forceDryRun, log: () => undefined });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
  return { posted, store, executor, flush };
}

const dry = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({
  id,
  type,
  parameters,
  timeoutMs: 5000,
  dryRun: true,
});

describe("CommandExecutor (Phase 1 dry-run)", () => {
  it("reports honest dry-run results without echoing typed text", async () => {
    const { posted, executor, flush } = harness();
    executor.handle(dry("t1", "TYPE_TEXT", { text: "s3cr3t-p4ssw0rd" }));
    await flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].path, "/api/agent/result");
    assert.equal(posted[0].body.commandId, "t1");
    assert.equal(posted[0].body.ok, true);
    assert.match(posted[0].body.message, /^\[DRY RUN\] TYPE_TEXT received/);
    assert.ok(!posted[0].body.message.includes("s3cr3t"), "typed text must never be echoed");
    assert.ok(posted[0].body.durationMs >= 0);
  });

  it("refuses live commands when no drivers exist", async () => {
    const { posted, executor, flush } = harness();
    executor.handle({ id: "live1", type: "MOVE_MOUSE", parameters: { x: 1, y: 1 }, timeoutMs: 5000, dryRun: false });
    await flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].body.ok, false);
    assert.match(posted[0].body.message, /Phase 1/);
  });

  it("refuses live commands when DRY_RUN=1 even if requested", async () => {
    const { posted, executor, flush } = harness(true);
    executor.handle({ id: "live2", type: "CLICK_MOUSE", parameters: {}, timeoutMs: 5000, dryRun: false });
    await flush();
    assert.equal(posted[0].body.ok, false);
    assert.match(posted[0].body.message, /DRY_RUN=1/);
  });

  it("rejects invalid commands with a reason", async () => {
    const { posted, executor, flush } = harness();
    executor.handle({ id: "bad1", type: "EXEC_SHELL", parameters: {}, timeoutMs: 5000, dryRun: true });
    await flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].body.ok, false);
    assert.match(posted[0].body.message, /rejected/);
  });

  it("ignores duplicate command ids without double-reporting", async () => {
    const { posted, store, executor, flush } = harness();
    const cmd = dry("dup1", "WAIT", { milliseconds: 5 });
    executor.handle(cmd);
    executor.handle(cmd);
    await flush();
    assert.equal(posted.length, 1);
    assert.equal(store.stats.duplicatesIgnored, 1);
  });

  it("emergency stop cancels queued work and halts until reconnect", async () => {
    const { posted, store, executor, flush } = harness();
    executor.emergencyStop("test signal");
    assert.equal(store.halted, true);
    executor.handle(dry("after-stop", "WAIT", { milliseconds: 5 }));
    await flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].body.ok, false);
    assert.match(posted[0].body.message, /emergency stop/);
    // A fresh hello (reconnect) clears the halt.
    store.onHello({ deviceId: "d", protocol: "1", heartbeatSeconds: 5, receivedAt: new Date().toISOString() });
    assert.equal(store.halted, false);
  });
});
