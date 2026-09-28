import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KeyboardDriver } from "../drivers/keyboard.js";
import { MouseDriver } from "../drivers/mouse.js";
import { createDrivers } from "../drivers/index.js";
import { DriverAbort, DriverError } from "../drivers/types.js";
import type { RobotLike } from "../drivers/types.js";

/** Recording fake of the native module. No OS calls; asserts mapping + order. */
function fakeRobot(failures: Partial<Record<string, Error>> = {}) {
  const calls: string[] = [];
  const maybe = (name: string) => {
    calls.push(name);
    if (failures[name]) throw failures[name];
  };
  const robot: RobotLike & { calls: string[]; last: Record<string, unknown[]> } = {
    calls,
    last: {},
    moveMouse: (x, y) => { maybe(`moveMouse:${x},${y}`); robot.last.moveMouse = [x, y]; },
    moveMouseSmooth: (x, y) => { maybe(`smooth:${x},${y}`); robot.last.smooth = [x, y]; },
    mouseClick: (button, dbl) => { maybe(`click:${button},${dbl}`); },
    mouseToggle: (down, button) => { maybe(`toggle:${down},${button}`); },
    dragMouse: (x, y) => { maybe(`drag:${x},${y}`); },
    scrollMouse: (x, y) => { maybe(`scroll:${x},${y}`); robot.last.scroll = [x, y]; },
    getScreenSize: () => ({ width: 1920, height: 1080 }),
    keyTap: (key, mod) => { maybe(`tap:${key},${JSON.stringify(mod)}`); robot.last.tap = [key, mod]; },
    keyToggle: (key, down) => { maybe(`key:${key},${down}`); },
    typeString: (s) => { maybe(`type:${s.length}`); },
    typeStringDelayed: (s, cpm) => { maybe(`typeDelayed:${s.length},${cpm}`); robot.last.cpm = [cpm]; },
    setKeyboardDelay: () => undefined,
    setMouseDelay: () => undefined,
  };
  return robot;
}

describe("MouseDriver (mapping + validation)", () => {
  it("moves instantly with durationMs 0 and smoothly otherwise", () => {
    const r = fakeRobot();
    const mouse = new MouseDriver(r);
    mouse.move(10, 20);
    mouse.move(30, 40, { durationMs: 600 });
    assert.deepEqual(r.calls, ["moveMouse:10,20", "smooth:30,40"]);
  });

  it("maps click / double-click / right-click", () => {
    const r = fakeRobot();
    const mouse = new MouseDriver(r);
    mouse.click("left");
    mouse.click("middle", { at: { x: 5, y: 6 } });
    mouse.doubleClick();
    mouse.rightClick();
    assert.deepEqual(r.calls, [
      "click:left,false",
      "moveMouse:5,6",
      "click:middle,false",
      "click:left,true",
      "click:right,false",
    ]);
  });

  it("rejects invalid coordinates and buttons before touching native code", () => {
    const r = fakeRobot();
    const mouse = new MouseDriver(r);
    for (const [x, y] of [[-1, 0], [0, 8193], [1.5, 2], [NaN, 2]]) {
      assert.throws(() => mouse.move(x, y), (e: unknown) => e instanceof DriverError && e.code === "INVALID_ARGUMENT");
    }
    assert.throws(() => mouse.click("side" as never), /button must be/);
    assert.deepEqual(r.calls, []);
  });

  it("scrolls with protocol direction semantics and validates amount", () => {
    const r = fakeRobot();
    const mouse = new MouseDriver(r);
    mouse.scroll("down", 3);
    mouse.scroll("up", 1);
    assert.deepEqual(r.last.scroll, [0, -1]);
    assert.throws(() => mouse.scroll("down", 0), /amount must be/);
    assert.throws(() => mouse.scroll("down", 61), /amount must be/);
    assert.throws(() => mouse.scroll("left" as never, 3), /direction must be/);
  });

  it("drags press → move → release and always releases on failure", () => {
    const r = fakeRobot();
    const mouse = new MouseDriver(r);
    mouse.drag(1, 2, 3, 4);
    assert.deepEqual(r.calls, ["moveMouse:1,2", "toggle:down,left", "drag:3,4", "toggle:up,left"]);

    const failing = fakeRobot({ "drag:3,4": new Error("native boom") });
    const mouse2 = new MouseDriver(failing);
    assert.throws(() => mouse2.drag(1, 2, 3, 4), /DRAG_MOUSE move failed/);
    // Button released despite the mid-drag failure — never stuck down.
    assert.equal(failing.calls.at(-1), "toggle:up,left");
  });

  it("honours abort between sub-steps", () => {
    const r = fakeRobot();
    const mouse = new MouseDriver(r);
    assert.throws(() => mouse.move(1, 2, { aborted: () => true }), (e: unknown) => e instanceof DriverAbort);
    assert.deepEqual(r.calls, []);
  });

  it("releaseAll lifts every button and never throws", () => {
    const r = fakeRobot({ "toggle:up,left": new Error("x"), "toggle:up,right": new Error("y"), "toggle:up,middle": new Error("z") });
    const mouse = new MouseDriver(r);
    mouse.releaseAll();
    mouse.releaseAll(); // idempotent
    assert.ok(r.calls.length === 6);
  });

  it("unavailable driver fails gracefully with guidance", () => {
    const mouse = new MouseDriver(null);
    assert.equal(mouse.available, false);
    assert.throws(() => mouse.move(1, 2), (e: unknown) => e instanceof DriverError && e.code === "DRIVER_UNAVAILABLE");
    mouse.releaseAll(); // no-op, never throws
  });
});

describe("KeyboardDriver (mapping + validation + cleanup)", () => {
  it("types text and converts delayMs to characters-per-minute", () => {
    const r = fakeRobot();
    const keyboard = new KeyboardDriver(r);
    keyboard.typeText("hello");
    keyboard.typeText("hi", { delayMs: 100 });
    assert.deepEqual(r.calls, ["type:5", "typeDelayed:2,600"]);
    assert.throws(() => keyboard.typeText("x".repeat(4001)), /at most 4000/);
    assert.throws(() => keyboard.typeText("x", { delayMs: 501 }), /delayMs must be/);
  });

  it("presses allowlisted keys and rejects anything else", () => {
    const r = fakeRobot();
    const keyboard = new KeyboardDriver(r);
    keyboard.pressKey("ENTER");
    keyboard.pressKey("a");
    keyboard.pressKey("F12");
    keyboard.pressKey("C", { modifiers: ["CTRL"] });
    assert.deepEqual(r.last.tap, ["c", ["control"]]);
    assert.throws(() => keyboard.pressKey("PRINTSCREEN"), /not allowlisted/);
    assert.throws(() => keyboard.pressKey(""), /not allowlisted/);
    assert.throws(() => keyboard.pressKey("ENTER", { modifiers: ["SUPER"] }), /not allowlisted/);
  });

  it("hotkey presses modifiers in order, taps, releases in reverse", () => {
    const r = fakeRobot();
    const keyboard = new KeyboardDriver(r);
    keyboard.hotkey(["CTRL", "SHIFT"], "S");
    assert.deepEqual(r.calls, ["key:control,down", "key:shift,down", "tap:s,undefined", "key:shift,up", "key:control,up"]);
  });

  it("hotkey splits compound modifier legs and maps META to Win", () => {
    const r = fakeRobot();
    const keyboard = new KeyboardDriver(r);
    keyboard.hotkey(["CTRL+ALT", "META"], "DELETE");
    assert.deepEqual(
      r.calls.filter((c) => c.startsWith("key:")),
      ["key:control,down", "key:alt,down", "key:command,down", "key:command,up", "key:alt,up", "key:control,up"],
    );
  });

  it("hotkey with no modifiers behaves as a single press", () => {
    const r = fakeRobot();
    const keyboard = new KeyboardDriver(r);
    keyboard.hotkey([], "ENTER");
    assert.deepEqual(r.calls, ["tap:enter,undefined"]);
  });

  it("hotkey releases modifiers even when the tap throws", () => {
    const r = fakeRobot({ "tap:s,undefined": new Error("native boom") });
    const keyboard = new KeyboardDriver(r);
    assert.throws(() => keyboard.hotkey(["CTRL"], "S"), /HOTKEY key tap failed/);
    assert.deepEqual(r.calls, ["key:control,down", "tap:s,undefined", "key:control,up"]);
  });

  it("releaseAll lifts every modifier and never throws", () => {
    const r = fakeRobot();
    const keyboard = new KeyboardDriver(r);
    keyboard.releaseAll();
    assert.deepEqual(r.calls, ["key:control,up", "key:alt,up", "key:shift,up", "key:command,up"]);
  });

  it("typed content never appears in error surfaces", () => {
    const secret = "s3cr3t-p4ssw0rd";
    const r = fakeRobot({ [`type:${secret.length}`]: new Error("native boom") });
    const keyboard = new KeyboardDriver(r);
    try {
      keyboard.typeText(secret);
      assert.fail("must throw");
    } catch (error) {
      assert.ok(error instanceof DriverError);
      assert.ok(!error.message.includes(secret), "secret must not leak into errors");
      assert.ok(!error.message.includes("s3cr3t"));
    }
  });
});

describe("createDrivers (resolution)", () => {
  it("shares one loaded module across both drivers", () => {
    const r = fakeRobot();
    const drivers = createDrivers({ mouse: "auto", keyboard: "auto" }, () => r);
    assert.equal(drivers.loaded, true);
    drivers.mouse.move(1, 2);
    drivers.keyboard.pressKey("ENTER");
    assert.ok(r.calls.length === 2);
  });

  it("resolves unavailable when the loader returns null", () => {
    const drivers = createDrivers({ mouse: "auto", keyboard: "auto" }, () => null);
    assert.equal(drivers.loaded, false);
    assert.equal(drivers.mouse.available, false);
    assert.equal(drivers.keyboard.available, false);
    assert.match(drivers.describe(), /dry-run only/);
  });

  it("honours simulated/off selection per device class", () => {
    const r = fakeRobot();
    const drivers = createDrivers({ mouse: "simulated", keyboard: "off" }, () => r);
    assert.equal(drivers.mouse.available, false);
    assert.equal(drivers.keyboard.available, false);
    assert.deepEqual(r.calls, []);
  });

  it("loader exceptions degrade to unavailable, never crash", () => {
    const drivers = createDrivers({ mouse: "robotjs", keyboard: "robotjs" }, () => {
      throw new Error("dlopen failed");
    });
    assert.equal(drivers.loaded, false);
  });
});
