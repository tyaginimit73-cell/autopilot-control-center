import {
  DRIVER_LIMITS,
  DriverAbort,
  DriverError,
  type AbortChecker,
  type ClickOptions,
  type DragOptions,
  type MouseButton,
  type MouseInput,
  type MoveOptions,
  type RobotLike,
  type ScrollDirection,
  type ScrollOptions,
} from "./types.js";

const VALID_BUTTONS: ReadonlySet<string> = new Set(["left", "right", "middle"]);

function checkAbort(aborted?: AbortChecker): void {
  if (aborted?.()) throw new DriverAbort();
}

function assertCoord(value: number, label: string): number {
  if (!Number.isInteger(value) || value < DRIVER_LIMITS.COORD_MIN || value > DRIVER_LIMITS.COORD_MAX) {
    throw new DriverError(
      "INVALID_ARGUMENT",
      `${label} must be an integer ${DRIVER_LIMITS.COORD_MIN}..${DRIVER_LIMITS.COORD_MAX}`,
    );
  }
  return value;
}

function assertDuration(durationMs: number | undefined): number {
  const value = durationMs ?? 0;
  if (!Number.isInteger(value) || value < 0 || value > DRIVER_LIMITS.DURATION_MAX_MS) {
    throw new DriverError("INVALID_ARGUMENT", `durationMs must be an integer 0..${DRIVER_LIMITS.DURATION_MAX_MS}`);
  }
  return value;
}

/**
 * Wrap a native call so OS-level failures surface as safe `DriverError`s.
 * robotjs throws static C++ messages; they are truncated and prefixed, never
 * interpolated with caller data, and stacks never leave this module.
 */
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

/**
 * Real-mouse driver. Every method validates its arguments against the protocol
 * limits, honours cooperative abort, and — for DRAG — guarantees the button is
 * released via try/finally even when a sub-step throws.
 *
 * Construct with `robot = null` (via `createDrivers`) on platforms without
 * native input: every action then fails with DRIVER_UNAVAILABLE instead of
 * crashing, while dry-run keeps working.
 */
export class MouseDriver implements MouseInput {
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
        "live mouse input needs the Windows agent with robotjs installed (re-send with dryRun:true to simulate)",
      );
    }
    return this.robot;
  }

  move(x: number, y: number, opts: MoveOptions = {}): void {
    const robot = this.need();
    assertCoord(x, "x");
    assertCoord(y, "y");
    const durationMs = assertDuration(opts.durationMs);
    checkAbort(opts.aborted);
    // Protocol semantics: durationMs 0 jumps instantly, >0 glides.
    if (durationMs > 0) safeCall(() => robot.moveMouseSmooth(x, y), "MOVE_MOUSE");
    else safeCall(() => robot.moveMouse(x, y), "MOVE_MOUSE");
  }

  click(button: MouseButton = "left", opts: ClickOptions = {}): void {
    const robot = this.need();
    if (!VALID_BUTTONS.has(button)) throw new DriverError("INVALID_ARGUMENT", `button must be left, right or middle`);
    if (opts.at) this.move(opts.at.x, opts.at.y, { aborted: opts.aborted });
    checkAbort(opts.aborted);
    safeCall(() => robot.mouseClick(button, false), "CLICK_MOUSE");
  }

  doubleClick(opts: ScrollOptions = {}): void {
    const robot = this.need();
    checkAbort(opts.aborted);
    safeCall(() => robot.mouseClick("left", true), "DOUBLE_CLICK_MOUSE");
  }

  rightClick(opts: ScrollOptions = {}): void {
    const robot = this.need();
    checkAbort(opts.aborted);
    safeCall(() => robot.mouseClick("right", false), "RIGHT_CLICK_MOUSE");
  }

  scroll(direction: ScrollDirection, amount: number, opts: ScrollOptions = {}): void {
    const robot = this.need();
    if (direction !== "up" && direction !== "down") {
      throw new DriverError("INVALID_ARGUMENT", `direction must be "up" or "down"`);
    }
    if (!Number.isInteger(amount) || amount < DRIVER_LIMITS.SCROLL_MIN || amount > DRIVER_LIMITS.SCROLL_MAX) {
      throw new DriverError(
        "INVALID_ARGUMENT",
        `amount must be an integer ${DRIVER_LIMITS.SCROLL_MIN}..${DRIVER_LIMITS.SCROLL_MAX}`,
      );
    }
    checkAbort(opts.aborted);
    // robotjs scrollMouse(x, y): positive vertical clicks scroll down.
    const clicks = direction === "down" ? amount : -amount;
    safeCall(() => robot.scrollMouse(0, clicks), "SCROLL_MOUSE");
  }

  drag(fromX: number, fromY: number, toX: number, toY: number, opts: DragOptions = {}): void {
    const robot = this.need();
    assertCoord(fromX, "x");
    assertCoord(fromY, "y");
    assertCoord(toX, "toX");
    assertCoord(toY, "toY");
    const durationMs = assertDuration(opts.durationMs);
    checkAbort(opts.aborted);

    // Press at the origin…
    this.move(fromX, fromY, { aborted: opts.aborted });
    checkAbort(opts.aborted);
    safeCall(() => robot.mouseToggle("down", "left"), "DRAG_MOUSE press");
    try {
      // …glide (or jump) to the destination while held…
      checkAbort(opts.aborted);
      if (durationMs > 0) safeCall(() => robot.moveMouseSmooth(toX, toY), "DRAG_MOUSE move");
      else safeCall(() => robot.dragMouse(toX, toY), "DRAG_MOUSE move");
    } finally {
      // …and ALWAYS release. A stuck button would hijack the user's desktop.
      try {
        robot.mouseToggle("up", "left");
      } catch {
        // Best effort: the original error (if any) takes precedence.
      }
    }
  }

  releaseAll(): void {
    if (!this.robot) return;
    for (const button of VALID_BUTTONS) {
      try {
        this.robot.mouseToggle("up", button);
      } catch {
        // Best effort — releaseAll must never throw.
      }
    }
  }
}
