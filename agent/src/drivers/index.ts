import { createRequire } from "node:module";
import { KeyboardDriver } from "./keyboard.js";
import { MouseDriver } from "./mouse.js";
import type { InputDrivers, RobotLike, RobotLoader } from "./types.js";

/**
 * Driver resolution (Phase 3).
 *
 * Real input is Windows-only and backed by exactly one native library:
 * robotjs 0.9.x (N-API prebuilds, Node 22 compatible). The module is loaded
 * lazily and never imported statically, so:
 *   - dry-run agents work on any platform without native code installed;
 *   - a missing/broken native module degrades to DRIVER_UNAVAILABLE results
 *     instead of crashing the agent;
 *   - unit tests inject a recording fake via the `loader` parameter.
 *
 * Selection honours `MOUSE_DRIVER` / `KEYBOARD_DRIVER` (`auto` default):
 *   auto       → robotjs on Windows, unavailable stub elsewhere
 *   robotjs    → attempt the native load (fails as DRIVER_UNAVAILABLE)
 *   simulated | none | off → always the unavailable stub (dry-run only)
 * Anything else falls back to `auto`.
 */

export { MouseDriver } from "./mouse.js";
export { KeyboardDriver } from "./keyboard.js";
export type {
  AbortChecker,
  ClickOptions,
  DragOptions,
  DriverErrorCode,
  HotkeyOptions,
  InputDrivers,
  KeyboardInput,
  KeyOptions,
  MouseButton,
  MouseInput,
  MoveOptions,
  RobotLike,
  RobotLoader,
  ScrollDirection,
  ScrollOptions,
  TypeOptions,
} from "./types.js";
export { DRIVER_LIMITS, DriverAbort, DriverError } from "./types.js";

const REQUIRED_ROBOT_FNS = [
  "moveMouse",
  "moveMouseSmooth",
  "mouseClick",
  "mouseToggle",
  "dragMouse",
  "scrollMouse",
  "keyTap",
  "keyToggle",
  "typeString",
  "typeStringDelayed",
] as const;

function isRobotLike(value: unknown): value is RobotLike {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  return REQUIRED_ROBOT_FNS.every((fn) => typeof (value as Record<string, unknown>)[fn] === "function");
}

/**
 * Production loader: require robotjs on Windows, validating its surface.
 * Returns null (never throws) when real input is unsupported or broken.
 */
export function loadRobot(): RobotLike | null {
  // Phase 3 implements the Windows desktop only; other platforms resolve to
  // the unavailable stub so live commands fail gracefully with guidance.
  if (process.platform !== "win32") return null;
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: unknown = require("robotjs");
    // robotjs is CJS (`module.exports = robotjs`); tolerate ESM-interop shape.
    const candidate = (mod as { default?: unknown })?.default ?? mod;
    return isRobotLike(candidate) ? (candidate as RobotLike) : null;
  } catch {
    return null;
  }
}

export interface DriverSelection {
  mouse?: string;
  keyboard?: string;
}

export interface ResolvedDrivers extends InputDrivers {
  /** True when at least the native module loaded (both drivers share it). */
  loaded: boolean;
  /** One-line human summary for the startup log (no secrets possible here). */
  describe(): string;
}

function selectKind(value: string | undefined): "auto" | "robotjs" | "off" {
  const v = (value ?? "auto").trim().toLowerCase();
  if (v === "robotjs" || v === "native") return "robotjs";
  if (v === "simulated" || v === "none" || v === "off" || v === "disabled") return "off";
  return "auto";
}

/**
 * Build the executor's drivers. The native module is loaded at most once and
 * shared by both drivers. `loader` is injectable for tests; production code
 * must not pass it.
 */
export function createDrivers(selection: DriverSelection = {}, loader: RobotLoader = loadRobot): ResolvedDrivers {
  const mouseKind = selectKind(selection.mouse);
  const keyboardKind = selectKind(selection.keyboard);
  let robot: RobotLike | null = null;
  if (mouseKind !== "off" || keyboardKind !== "off") {
    try {
      robot = loader();
    } catch {
      robot = null;
    }
  }
  const mouse = new MouseDriver(mouseKind === "off" ? null : robot);
  const keyboard = new KeyboardDriver(keyboardKind === "off" ? null : robot);
  const loaded = robot !== null;
  return {
    mouse,
    keyboard,
    loaded,
    describe: () =>
      loaded
        ? `robotjs (mouse=${mouse.name}, keyboard=${keyboard.name})`
        : `unavailable (${process.platform !== "win32" ? "not Windows" : "robotjs not loadable"} — dry-run only)`,
  };
}

/** Release any held buttons/modifiers on both drivers. Never throws. */
export function releaseAllDrivers(drivers: InputDrivers): void {
  try {
    drivers.mouse.releaseAll();
  } catch {
    // releaseAll implementations never throw; belt and braces.
  }
  try {
    drivers.keyboard.releaseAll();
  } catch {
    // releaseAll implementations never throw; belt and braces.
  }
}
