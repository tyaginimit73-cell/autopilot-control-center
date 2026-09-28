import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CommandExecutor, type AgentCommandResult } from "../executor/index.js";
import { AgentStore } from "../state/store.js";
import type { ControlPlaneClient } from "../transport/client.js";
import type { InputDrivers, MouseInput, KeyboardInput } from "../drivers/index.js";
import { DriverError } from "../drivers/types.js";

/** Recording fake drivers: prove dispatch without touching any OS input. */
function fakeDrivers() {
  const calls: string[] = [];
  const mouse: MouseInput & { calls: string[] } = {
    calls,
    name: "fake",
    available: true,
    move: (x, y, o) => { calls.push(`move:${x},${y},${o?.durationMs ?? 0}`); },
    click: (b, o) => { calls.push(`click:${b ?? "left"},${o?.at ? `${o.at.x},${o.at.y}` : "-"}`); },
    doubleClick: () => { calls.push("doubleClick"); },
    rightClick: () => { calls.push("rightClick"); },
    scroll: (d, a) => { calls.push(`scroll:${d},${a}`); },
    drag: (x1, y1, x2, y2) => { calls.push(`drag:${x1},${y1},${x2},${y2}`); },
    releaseAll: () => { calls.push("mouse:releaseAll"); },
  };
  const keyboard: KeyboardInput = {
    name: "fake",
    available: true,
    typeText: (t, o) => { calls.push(`type:${t.length},${o?.delayMs ?? 0}`); },
    pressKey: (k, o) => { calls.push(`press:${k},${(o?.modifiers ?? []).join("+")}`); },
    hotkey: (m, k) => { calls.push(`hotkey:${m.join("+")},${k}`); },
    releaseAll: () => { calls.push("keyboard:releaseAll"); },
  };
  return { drivers: { mouse, keyboard } satisfies InputDrivers, calls };
}

function harness(drivers?: InputDrivers, forceDryRun = false) {
  const posted: { path: string; body: AgentCommandResult }[] = [];
  const logs: string[] = [];
  const fake = {
    post: async (path: string, body: AgentCommandResult) => {
      posted.push({ path, body });
      return { ok: true };
    },
  } as unknown as ControlPlaneClient;
  const store = new AgentStore();
  const executor = new CommandExecutor({
    client: fake,
    store,
    profiles: [],
    forceDryRun,
    drivers: drivers ?? fakeDrivers().drivers,
    log: (m) => logs.push(m),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
  return { posted, logs, store, executor, flush };
}

const live = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({
  id, type, parameters, timeoutMs: 5000, dryRun: false,
});

describe("CommandExecutor (Phase 3 live input)", () => {
  it("dry-run never touches the drivers", async () => {
    const { drivers, calls } = fakeDrivers();
    const { posted, executor, flush } = harness(drivers);
    executor.handle({ id: "d1", type: "TYPE_TEXT", parameters: { text: "hello" }, timeoutMs: 5000, dryRun: true });
    executor.handle({ id: "d2", type: "MOVE_MOUSE", parameters: { x: 1, y: 1 }, timeoutMs: 5000, dryRun: true });
    await flush();
    assert.equal(posted.length, 2);
    assert.ok(posted.every((p) => p.body.ok));
    assert.deepEqual(calls, []);
  });

  it("live input dispatches to the drivers and reports [LIVE] results", async () => {
    const { drivers, calls } = fakeDrivers();
    const { posted, executor, flush } = harness(drivers);
    executor.handle(live("m1", "MOVE_MOUSE", { x: 800, y: 500, durationMs: 600 }));
    executor.handle(live("c1", "CLICK_MOUSE", { button: "left", x: 9, y: 9 }));
    executor.handle(live("dc1", "DOUBLE_CLICK_MOUSE"));
    executor.handle(live("rc1", "RIGHT_CLICK_MOUSE"));
    executor.handle(live("s1", "SCROLL_MOUSE", { direction: "down", amount: 3 }));
    executor.handle(live("dg1", "DRAG_MOUSE", { x: 1, y: 1, toX: 5, toY: 5, durationMs: 100 }));
    executor.handle(live("t1", "TYPE_TEXT", { text: "hello" }));
    executor.handle(live("k1", "PRESS_KEY", { key: "ENTER" }));
    executor.handle(live("h1", "HOTKEY", { modifiers: ["CTRL"], key: "C" }));
    await flush();
    assert.equal(posted.length, 9);
    assert.ok(posted.every((p) => p.body.ok), "all live input must succeed against the fake");
    assert.ok(posted.every((p) => p.body.message.startsWith("[LIVE]")));
    assert.ok(posted.every((p) => (p.body.data as Record<string, unknown>)?.dryRun === false));
    assert.deepEqual(calls, [
      "move:800,500,600",
      "click:left,9,9",
      "doubleClick",
      "rightClick",
      "scroll:down,3",
      "drag:1,1,5,5",
      "type:5,0",
      "press:ENTER,",
      "hotkey:CTRL,C",
    ]);
  });

  it("invalid commands are rejected before the driver is reached", async () => {
    const { drivers, calls } = fakeDrivers();
    const { posted, executor, flush } = harness(drivers);
    executor.handle(live("bad1", "PRESS_KEY", { key: "PRINTSCREEN" }));
    executor.handle(live("bad2", "EXEC_SHELL"));
    await flush();
    assert.equal(posted.length, 2);
    assert.ok(posted.every((p) => !p.body.ok && p.body.message.startsWith("rejected:")));
    assert.deepEqual(calls, []);
  });

  it("live non-input actions stay honestly unsupported", async () => {
    const { drivers, calls } = fakeDrivers();
    const { posted, executor, flush } = harness(drivers);
    executor.handle(live("w1", "OPEN_URL", { url: "https://example.com" }));
    executor.handle(live("w2", "WAIT", { milliseconds: 5 }));
    await flush();
    assert.equal(posted.length, 2);
    assert.ok(posted.every((p) => !p.body.ok && /no Phase-3 driver/.test(p.body.message)));
    assert.deepEqual(calls, []);
  });

  it("halted executor rejects live input without touching the driver", async () => {
    const { drivers, calls } = fakeDrivers();
    const { posted, executor, flush } = harness(drivers);
    executor.emergencyStop("test signal");
    calls.length = 0; // ignore the stop-time releaseAll
    executor.handle(live("h1", "CLICK_MOUSE"));
    await flush();
    assert.equal(posted.length, 1);
    assert.match(posted[0].body.message, /emergency stop/);
    assert.deepEqual(calls, []);
  });

  it("emergency stop releases held buttons and modifiers", async () => {
    const { drivers, calls } = fakeDrivers();
    const { executor } = harness(drivers);
    executor.emergencyStop("test signal");
    executor.emergencyStop("second signal"); // idempotent
    assert.deepEqual(calls, ["mouse:releaseAll", "keyboard:releaseAll", "mouse:releaseAll", "keyboard:releaseAll"]);
  });

  it("driver failures become structured results without stacks", async () => {
    const { drivers, calls } = fakeDrivers();
    drivers.mouse.move = () => { throw new DriverError("DRIVER_ERROR", "MOVE_MOUSE failed (native call failed)"); };
    const { posted, executor, flush } = harness(drivers);
    executor.handle(live("f1", "MOVE_MOUSE", { x: 1, y: 1 }));
    await flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].body.ok, false);
    assert.match(posted[0].body.message, /live MOVE_MOUSE failed \[DRIVER_ERROR\]/);
    assert.ok(!posted[0].body.message.includes("at "), "no stack traces in results");
    assert.equal(calls.length, 0);
  });

  it("unavailable drivers produce guided failures, not crashes", async () => {
    const { drivers } = fakeDrivers();
    const down = {
      mouse: { ...drivers.mouse, available: false, move: () => { throw new DriverError("DRIVER_UNAVAILABLE", "needs Windows"); } },
      keyboard: drivers.keyboard,
    } satisfies InputDrivers;
    const { posted, executor, flush } = harness(down);
    executor.handle(live("u1", "MOVE_MOUSE", { x: 1, y: 1 }));
    await flush();
    assert.match(posted[0].body.message, /\[DRIVER_UNAVAILABLE\]/);
  });

  it("TYPE_TEXT content never appears in logs or results", async () => {
    const secret = "s3cr3t-p4ssw0rd";
    const { drivers, calls } = fakeDrivers();
    const { posted, logs, executor, flush } = harness(drivers);
    executor.handle(live("sec1", "TYPE_TEXT", { text: secret }));
    await flush();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].body.ok, true);
    const surfaces = [posted[0].body.message, JSON.stringify(posted[0].body.data), ...logs, ...calls].join("\n");
    assert.ok(!surfaces.includes(secret), "typed text must never surface");
    assert.ok(!surfaces.includes("s3cr3t"));
    assert.match(posted[0].body.message, /\(15 chars\)/);
  });
});
