import {
  DRIVER_LIMITS,
  DriverAbort,
  DriverError,
  type AbortChecker,
  type HotkeyOptions,
  type KeyboardInput,
  type KeyOptions,
  type RobotLike,
  type TypeOptions,
} from "./types.js";

/**
 * SAFE_KEYS → robotjs key names. This is the SAME subset as `SAFE_KEYS` in
 * `shared/src/catalog/index.ts` (the source of truth) and `SHARED_SAFE_KEYS`
 * in the agent allowlist — the driver re-validates so nothing outside this
 * list can ever reach the OS, even if validation upstream is bypassed.
 */
const KEY_MAP: Readonly<Record<string, string>> = {
  ENTER: "enter",
  TAB: "tab",
  ESCAPE: "escape",
  BACKSPACE: "backspace",
  DELETE: "delete",
  SPACE: "space",
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
  HOME: "home",
  END: "end",
  PAGEUP: "pageup",
  PAGEDOWN: "pagedown",
  F1: "f1",
  F2: "f2",
  F3: "f3",
  F4: "f4",
  F5: "f5",
  F6: "f6",
  F7: "f7",
  F8: "f8",
  F9: "f9",
  F10: "f10",
  F11: "f11",
  F12: "f12",
  A: "a",
  C: "c",
  V: "v",
  X: "x",
  Y: "y",
  Z: "z",
  F: "f",
  G: "g",
  N: "n",
  P: "p",
  R: "r",
  S: "s",
  T: "t",
  W: "w",
};

/** SAFE_MODIFIERS → robotjs names. robotjs maps "command" to the Win key on Windows. */
const MODIFIER_MAP: Readonly<Record<string, string>> = {
  CTRL: "control",
  ALT: "alt",
  SHIFT: "shift",
  META: "command",
};

function checkAbort(aborted?: AbortChecker): void {
  if (aborted?.()) throw new DriverAbort();
}

function safeCall(fn: () => void, what: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof DriverAbort || error instanceof DriverError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const trimmed = detail.length > 120 ? `${detail.slice(0, 119)}…` : detail;
    throw new DriverError("DRIVER_ERROR", `${what} failed (${trimmed || "native call failed"})`);
  }
}

function mapKey(key: string): string {
  const mapped = KEY_MAP[key.toUpperCase()];
  if (!mapped) throw new DriverError("INVALID_ARGUMENT", `key "${key}" is not allowlisted`);
  return mapped;
}

/**
 * Map + validate modifiers. Compound legs ("CTRL+ALT") are split, matching the
 * agent allowlist. Unknown modifiers are rejected — there is deliberately no
 * arbitrary-modifier passthrough.
 */
function mapModifiers(modifiers: string[]): string[] {
  const mapped: string[] = [];
  for (const modifier of modifiers) {
    const legs = modifier
      .split("+")
      .map((leg) => leg.trim().toUpperCase())
      .filter(Boolean);
    if (!legs.length) throw new DriverError("INVALID_ARGUMENT", `modifier "${modifier}" is not allowlisted`);
    for (const leg of legs) {
      const robotMod = MODIFIER_MAP[leg];
      if (!robotMod) throw new DriverError("INVALID_ARGUMENT", `modifier "${modifier}" is not allowlisted`);
      if (!mapped.includes(robotMod)) mapped.push(robotMod);
    }
  }
  return mapped;
}

/**
 * Real-keyboard driver. TYPE_TEXT content is never logged, never echoed in
 * errors, and never stored — it flows straight from the validated command to
 * the native call. HOTKEY presses modifiers in order and releases them in
 * reverse order inside try/finally, so a mid-sequence failure or abort can
 * never leave a modifier stuck down.
 */
export class KeyboardDriver implements KeyboardInput {
  readonly name: string;

  constructor(private readonly robot: RobotLike | null) {
    this.name = robot ? "robotjs" : "unavailable";
  }

  get available(): boolean {
    return this.robot !== null;
  }

  private need(): RobotLike {
    if (!this.robot) {
      throw new DriverError(
        "DRIVER_UNAVAILABLE",
        "live keyboard input needs the Windows agent with robotjs installed (re-send with dryRun:true to simulate)",
      );
    }
    return this.robot;
  }

  typeText(text: string, opts: TypeOptions = {}): void {
    const robot = this.need();
    if (typeof text !== "string" || text.length > DRIVER_LIMITS.TEXT_MAX) {
      throw new DriverError("INVALID_ARGUMENT", `text must be a string of at most ${DRIVER_LIMITS.TEXT_MAX} chars`);
    }
    const delayMs = opts.delayMs ?? 0;
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > DRIVER_LIMITS.DELAY_MAX_MS) {
      throw new DriverError("INVALID_ARGUMENT", `delayMs must be an integer 0..${DRIVER_LIMITS.DELAY_MAX_MS}`);
    }
    checkAbort(opts.aborted);
    // robotjs takes characters-per-minute; delayMs is the protocol unit.
    if (delayMs > 0) {
      const cpm = Math.max(1, Math.round(60_000 / delayMs));
      safeCall(() => robot.typeStringDelayed(text, cpm), "TYPE_TEXT");
    } else {
      safeCall(() => robot.typeString(text), "TYPE_TEXT");
    }
  }

  pressKey(key: string, opts: KeyOptions = {}): void {
    const robot = this.need();
    const mappedKey = mapKey(key);
    const mappedMods = mapModifiers(opts.modifiers ?? []);
    checkAbort(opts.aborted);
    safeCall(() => robot.keyTap(mappedKey, mappedMods), "PRESS_KEY");
  }

  hotkey(modifiers: string[], key: string, opts: HotkeyOptions = {}): void {
    const robot = this.need();
    const mappedKey = mapKey(key);
    const mappedMods = mapModifiers(modifiers);
    checkAbort(opts.aborted);
    // No modifiers (server permits key-only HOTKEY): behave as a single press.
    if (!mappedMods.length) {
      safeCall(() => robot.keyTap(mappedKey), "HOTKEY");
      return;
    }
    // Press in order…
    for (const mod of mappedMods) {
      checkAbort(opts.aborted);
      safeCall(() => robot.keyToggle(mod, "down"), "HOTKEY modifier press");
    }
    try {
      // …tap the key…
      checkAbort(opts.aborted);
      safeCall(() => robot.keyTap(mappedKey), "HOTKEY key tap");
    } finally {
      // …and ALWAYS release in reverse order. A stuck CTRL/ALT/SHIFT/META
      // would hijack the user's desktop.
      for (const mod of [...mappedMods].reverse()) {
        try {
          robot.keyToggle(mod, "up");
        } catch {
          // Best effort: the original error (if any) takes precedence.
        }
      }
    }
  }

  releaseAll(): void {
    if (!this.robot) return;
    for (const mod of Object.values(MODIFIER_MAP)) {
      try {
        this.robot.keyToggle(mod, "up");
      } catch {
        // Best effort — releaseAll must never throw.
      }
    }
  }
}
