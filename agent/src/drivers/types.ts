/**
 * Driver-layer shared types (Phase 3).
 *
 * The executor talks ONLY to the `MouseInput` / `KeyboardInput` interfaces in
 * this file. It never imports robotjs (or any OS module): the concrete classes
 * in `mouse.ts` / `keyboard.ts` wrap a lazily loaded native module, and resolve
 * to "unavailable" stubs wherever real input is unsupported. This keeps dry-run
 * honest by construction and the driver replaceable/testable.
 *
 * SECURITY: no value flowing through this layer is ever logged. TYPE_TEXT
 * content in particular must only ever appear as a length in messages.
 */

/** Returns true when an emergency stop (or epoch change) requests an abort. */
export type AbortChecker = () => boolean;

/** Mouse buttons accepted by the protocol (`button` param, default "left"). */
export type MouseButton = "left" | "right" | "middle";

export type ScrollDirection = "up" | "down";

/**
 * Protocol limits mirrored from `@autopilot/shared` + the agent allowlist.
 * The driver re-checks every value so a compromised validation path can never
 * let a malformed command reach the OS.
 */
export const DRIVER_LIMITS = {
  COORD_MIN: 0,
  COORD_MAX: 8192,
  SCROLL_MIN: 1,
  SCROLL_MAX: 60,
  TEXT_MAX: 4000,
  DURATION_MAX_MS: 15_000,
  DELAY_MAX_MS: 500,
} as const;

/** Stable, UI-safe failure codes. Messages carry no secrets and no stacks. */
export type DriverErrorCode =
  | "DRIVER_UNAVAILABLE"
  | "INVALID_ARGUMENT"
  | "ABORTED"
  | "DRIVER_ERROR";

export class DriverError extends Error {
  readonly code: DriverErrorCode;
  constructor(code: DriverErrorCode, message: string) {
    super(message);
    this.name = "DriverError";
    this.code = code;
  }
}

/**
 * Internal control-flow signal for cooperative abort between driver sub-steps.
 * The executor maps this to a "cancelled: emergency stop" result, never a crash.
 */
export class DriverAbort extends Error {
  constructor() {
    super("aborted: emergency stop is active");
    this.name = "DriverAbort";
  }
}

export interface MoveOptions {
  durationMs?: number;
  aborted?: AbortChecker;
}

export interface ClickOptions {
  at?: { x: number; y: number };
  aborted?: AbortChecker;
}

export interface ScrollOptions {
  aborted?: AbortChecker;
}

export interface DragOptions {
  durationMs?: number;
  aborted?: AbortChecker;
}

export interface TypeOptions {
  delayMs?: number;
  aborted?: AbortChecker;
}

export interface KeyOptions {
  modifiers?: string[];
  aborted?: AbortChecker;
}

export interface HotkeyOptions {
  aborted?: AbortChecker;
}

/** Executor-facing mouse contract. Implemented by `MouseDriver`. */
export interface MouseInput {
  readonly name: string;
  readonly available: boolean;
  move(x: number, y: number, opts?: MoveOptions): void;
  click(button?: MouseButton, opts?: ClickOptions): void;
  doubleClick(opts?: ScrollOptions): void;
  rightClick(opts?: ScrollOptions): void;
  scroll(direction: ScrollDirection, amount: number, opts?: ScrollOptions): void;
  drag(fromX: number, fromY: number, toX: number, toY: number, opts?: DragOptions): void;
  /** Best-effort release of any held button. Never throws. Idempotent. */
  releaseAll(): void;
}

/** Executor-facing keyboard contract. Implemented by `KeyboardDriver`. */
export interface KeyboardInput {
  readonly name: string;
  readonly available: boolean;
  typeText(text: string, opts?: TypeOptions): void;
  pressKey(key: string, opts?: KeyOptions): void;
  hotkey(modifiers: string[], key: string, opts?: HotkeyOptions): void;
  /** Best-effort release of any held modifier. Never throws. Idempotent. */
  releaseAll(): void;
}

export interface InputDrivers {
  mouse: MouseInput;
  keyboard: KeyboardInput;
}

/**
 * Structural subset of the robotjs API used by the drivers. Declared locally
 * (instead of `import type from "robotjs"`) so this module — and everything
 * that type-checks against it — never requires the native package to be
 * installed. The production loader (`drivers/index.ts`) validates the real
 * module against this surface at runtime before use.
 */
export interface RobotLike {
  moveMouse(x: number, y: number): void;
  moveMouseSmooth(x: number, y: number): void;
  mouseClick(button?: string, double?: boolean): void;
  mouseToggle(down?: string, button?: string): void;
  dragMouse(x: number, y: number): void;
  scrollMouse(x: number, y: number): void;
  getScreenSize(): { width: number; height: number };
  keyTap(key: string, modifier?: string | string[]): void;
  keyToggle(key: string, down: string, modifier?: string | string[]): void;
  typeString(value: string): void;
  typeStringDelayed(value: string, cpm: number): void;
  setKeyboardDelay(ms: number): void;
  setMouseDelay(ms: number): void;
}

/** Production loader returns the native module, or null when unavailable. */
export type RobotLoader = () => RobotLike | null;
