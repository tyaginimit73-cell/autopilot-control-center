import { validate, type AgentCommand, type Profile } from "../security/allowlist.js";
import type { AgentStore } from "../state/store.js";
import type { ControlPlaneClient } from "../transport/client.js";
import { createDrivers, DriverAbort, DriverError, releaseAllDrivers } from "../drivers/index.js";
import type { InputDrivers, MouseButton, ScrollDirection } from "../drivers/index.js";

/**
 * Command executor (Phase 3: dry-run + real Windows mouse/keyboard).
 *
 * Pipeline: parse → allowlist-validate → halt/dedup checks → dry-run gate →
 * dry-run describe OR live driver execution → honest result →
 * POST /api/agent/result (retried, idempotent).
 *
 * The executor holds ONLY the abstract `InputDrivers` interfaces — there are
 * no OS/native imports in this file. `dryRun: true` therefore still cannot
 * produce a physical effect by construction (it never touches the drivers).
 * Live mouse/keyboard commands dispatch through the driver layer, which owns
 * all Windows-specific details, argument re-validation and cleanup.
 * `DRY_RUN=1` in the agent env still refuses every live run outright.
 */

export interface AgentCommandResult {
  commandId: string;
  ok: boolean;
  message: string;
  durationMs: number;
  data?: Record<string, unknown>;
}

export interface ExecutorOptions {
  client: ControlPlaneClient;
  store: AgentStore;
  /** local application profiles consulted by OPEN_APPLICATION validation */
  profiles: Profile[];
  /** agent-side DRY_RUN env flag: when true, live runs are refused outright */
  forceDryRun: boolean;
  /** input drivers (default: resolved from MOUSE_DRIVER/KEYBOARD_DRIVER) */
  drivers?: InputDrivers;
  log?: (message: string) => void;
}

/** Action types with a real Phase-3 driver behind them. Everything else live is refused. */
const LIVE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "MOVE_MOUSE",
  "CLICK_MOUSE",
  "DOUBLE_CLICK_MOUSE",
  "RIGHT_CLICK_MOUSE",
  "SCROLL_MOUSE",
  "DRAG_MOUSE",
  "TYPE_TEXT",
  "PRESS_KEY",
  "HOTKEY",
]);

const RESULT_MESSAGE_LIMIT = 500;

function truncate(message: string): string {
  return message.length > RESULT_MESSAGE_LIMIT ? `${message.slice(0, RESULT_MESSAGE_LIMIT - 1)}…` : message;
}

export class CommandExecutor {
  /** Serial queue: at most one command "executes" at a time. */
  private tail: Promise<void> = Promise.resolve();
  private epoch = 0;

  private readonly drivers: InputDrivers;

  constructor(private readonly opts: ExecutorOptions) {
    this.drivers = opts.drivers ?? createDrivers({ mouse: "auto", keyboard: "auto" });
  }

  get halted(): boolean {
    return this.opts.store.halted;
  }

  /** Enqueue an inbound SSE `command` payload. Never throws. */
  handle(raw: unknown) {
    const receivedAt = Date.now();
    this.tail = this.tail
      .then(() => this.processOne(raw, receivedAt, this.epoch))
      .catch((error) => this.opts.log?.(`[agent] executor error: ${(error as Error).message}`));
  }

  /**
   * Emergency stop: cancel everything still queued, halt the executor, mark
   * state IDLE, and release any held mouse button / keyboard modifiers. The
   * serial queue means the stop lands between commands; the in-flight live
   * command (if any) observes the halt via its abort checker and unwinds
   * through driver try/finally cleanup. A reconnect (fresh `hello`) clears the
   * halt; until then every command is rejected with a clear reason.
   * Idempotent: releaseAll never throws, so repeated stops are safe.
   */
  emergencyStop(reason: string) {
    this.epoch += 1;
    this.opts.store.onEmergencyStop(reason);
    releaseAllDrivers(this.drivers);
    this.opts.log?.(`[agent] EMERGENCY STOP — executor halted (${reason}); reconnect or restart to resume`);
  }

  private async processOne(raw: unknown, receivedAt: number, epoch: number) {
    const started = Date.now();
    const fail = (commandId: string, message: string): AgentCommandResult => ({
      commandId,
      ok: false,
      message: truncate(message),
      durationMs: Math.max(0, Date.now() - started),
    });

    // 1. Structural validation (shape + allowlist + machine-local profiles).
    const report = validate(raw, this.opts.profiles);
    if (!report.ok || !report.command) {
      const id = extractId(raw);
      this.opts.store.stats.commandsRejected += 1;
      if (id) await this.deliver(fail(id, `rejected: ${report.reason ?? "invalid command"}`));
      else this.opts.log?.(`[agent] rejected command without id: ${report.reason ?? "invalid command"}`);
      return;
    }
    const command = report.command;
    this.opts.store.stats.commandsReceived += 1;
    this.opts.store.lastCommandAt = new Date().toISOString();

    // 2. Emergency-stop / epoch cancellation (covers items queued before the stop).
    if (epoch !== this.epoch || this.opts.store.halted) {
      this.opts.store.stats.commandsRejected += 1;
      await this.deliver(fail(command.id, "cancelled: emergency stop is active (reconnect or restart the agent to resume)"));
      return;
    }

    // 3. Redelivery guard: never execute or double-report the same command id.
    if (!this.opts.store.markSeen(command.id)) {
      this.opts.log?.(`[agent] ignoring duplicate command ${command.id}`);
      return;
    }

    // 4. Dry-run gate. DRY_RUN=1 still refuses every live run outright. A live
    // command for mouse/keyboard dispatches to the driver layer; any other
    // live action (browser, window, control-flow) is answered honestly.
    if (this.opts.forceDryRun && !command.dryRun) {
      this.opts.store.stats.commandsRejected += 1;
      await this.deliver(
        fail(command.id, `refused: agent runs with DRY_RUN=1, but the server requested a live ${command.type} run`),
      );
      return;
    }
    if (!command.dryRun) {
      await this.executeLive(command, receivedAt, epoch, fail);
      return;
    }

    // 5. Dry-run "execution": describe what WOULD happen. No input APIs are
    // reachable from this module, so a physical effect is impossible by
    // construction. Duration is measured honestly (queue wait excluded).
    const execStarted = Date.now();
    this.opts.store.automation = "RUNNING";
    try {
      const message = describeDryRun(command);
      this.opts.store.stats.commandsCompleted += 1;
      await this.deliver({
        commandId: command.id,
        ok: true,
        message: truncate(message),
        durationMs: Math.max(0, Date.now() - execStarted),
        data: { dryRun: true, phase: 1, queueWaitMs: Math.max(0, execStarted - receivedAt) },
      });
    } finally {
      this.opts.store.automation = "IDLE";
    }
  }

  /**
   * Step 4b — live execution through the driver layer. Halt state is re-checked
   * immediately before real input; the drivers also observe aborts cooperatively
   * between sub-steps. Results are structured and secret-free: typed text is
   * reported as a length only, failures carry a safe code, and OS stacks never
   * leave the agent.
   */
  private async executeLive(
    command: AgentCommand,
    receivedAt: number,
    epoch: number,
    fail: (commandId: string, message: string) => AgentCommandResult,
  ) {
    if (!LIVE_INPUT_TYPES.has(command.type)) {
      this.opts.store.stats.commandsRejected += 1;
      await this.deliver(
        fail(
          command.id,
          `unsupported: live ${command.type} has no Phase-3 driver yet (mouse/keyboard only — re-send with dryRun:true to simulate)`,
        ),
      );
      return;
    }
    // Re-check the halt immediately before touching real input (§8).
    if (epoch !== this.epoch || this.opts.store.halted) {
      this.opts.store.stats.commandsRejected += 1;
      await this.deliver(
        fail(command.id, "cancelled: emergency stop is active (reconnect or restart the agent to resume)"),
      );
      return;
    }
    const aborted = () => epoch !== this.epoch || this.opts.store.halted;
    const execStarted = Date.now();
    this.opts.store.automation = "RUNNING";
    try {
      dispatchLive(this.drivers, command, aborted);
      this.opts.store.stats.commandsCompleted += 1;
      await this.deliver({
        commandId: command.id,
        ok: true,
        message: truncate(describeLive(command)),
        durationMs: Math.max(0, Date.now() - execStarted),
        data: { dryRun: false, phase: 3, queueWaitMs: Math.max(0, execStarted - receivedAt) },
      });
    } catch (error) {
      this.opts.store.stats.commandsRejected += 1;
      if (error instanceof DriverAbort) {
        await this.deliver(
          fail(command.id, "cancelled: emergency stop is active (reconnect or restart the agent to resume)"),
        );
        return;
      }
      const code = error instanceof DriverError ? error.code : "DRIVER_ERROR";
      const detail = error instanceof Error ? error.message : String(error);
      await this.deliver(fail(command.id, `live ${command.type} failed [${code}]: ${detail}`));
    } finally {
      this.opts.store.automation = "IDLE";
    }
  }

  /** Deliver a result with bounded retries. Redelivery is safe: the server
   * resolves each command id at most once (`matched:false` afterwards). */
  private async deliver(result: AgentCommandResult) {
    const log = this.opts.log ?? (() => undefined);
    let attempt = 0;
    for (;;) {
      try {
        await this.opts.client.post("/api/agent/result", result, 10_000);
        return;
      } catch (error) {
        attempt += 1;
        if (attempt >= 4) {
          log(`[agent] dropping result for ${result.commandId} after ${attempt} attempts: ${(error as Error).message}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }
}

function extractId(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "id" in raw && typeof (raw as { id: unknown }).id === "string") {
    const id = (raw as { id: string }).id;
    return id.length >= 1 && id.length <= 64 ? id : null;
  }
  return null;
}

/**
 * Thin dispatch from validated live commands to driver methods. This function
 * performs NO OS calls itself and NO re-validation beyond protocol defaults —
 * the driver layer owns argument checks, abort handling and cleanup. Missing
 * numerics fall through as NaN so the driver rejects them as INVALID_ARGUMENT
 * (allowlist + server schemas normally guarantee their presence).
 */
function dispatchLive(drivers: InputDrivers, command: AgentCommand, aborted: () => boolean): void {
  const p = command.parameters;
  switch (command.type) {
    case "MOVE_MOUSE":
      drivers.mouse.move(p.x ?? NaN, p.y ?? NaN, { durationMs: p.durationMs, aborted });
      return;
    case "CLICK_MOUSE": {
      const at = typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : undefined;
      drivers.mouse.click((p.button ?? "left") as MouseButton, { at, aborted });
      return;
    }
    case "DOUBLE_CLICK_MOUSE":
      drivers.mouse.doubleClick({ aborted });
      return;
    case "RIGHT_CLICK_MOUSE":
      drivers.mouse.rightClick({ aborted });
      return;
    case "SCROLL_MOUSE":
      drivers.mouse.scroll((p.direction ?? "down") as ScrollDirection, p.amount ?? 3, { aborted });
      return;
    case "DRAG_MOUSE":
      drivers.mouse.drag(p.x ?? NaN, p.y ?? NaN, p.toX ?? NaN, p.toY ?? NaN, { durationMs: p.durationMs, aborted });
      return;
    case "TYPE_TEXT":
      drivers.keyboard.typeText(p.text ?? "", { delayMs: p.delayMs, aborted });
      return;
    case "PRESS_KEY":
      drivers.keyboard.pressKey(p.key ?? "", { modifiers: p.modifiers, aborted });
      return;
    case "HOTKEY":
      drivers.keyboard.hotkey(p.modifiers ?? [], p.key ?? "", { aborted });
      return;
    default:
      // Unreachable: executeLive gates on LIVE_INPUT_TYPES. Belt and braces.
      throw new DriverError("INVALID_ARGUMENT", `no live driver for ${command.type}`);
  }
}

/**
 * Human-readable live-execution summaries. Like the dry-run descriptions,
 * secret-bearing fields are NEVER echoed: typed text is reported by length
 * only. Coordinates and allowlisted key names are safe metadata.
 */
function describeLive(command: AgentCommand): string {
  const p = command.parameters as Record<string, unknown>;
  const num = (value: unknown): string => (typeof value === "number" ? String(value) : "?");
  switch (command.type) {
    case "MOVE_MOUSE":
      return `[LIVE] MOVE_MOUSE executed → ${num(p.x)},${num(p.y)}`;
    case "CLICK_MOUSE":
      return `[LIVE] CLICK_MOUSE executed (${String(p.button ?? "left")} button)`;
    case "DOUBLE_CLICK_MOUSE":
      return "[LIVE] DOUBLE_CLICK_MOUSE executed (left button)";
    case "RIGHT_CLICK_MOUSE":
      return "[LIVE] RIGHT_CLICK_MOUSE executed";
    case "SCROLL_MOUSE":
      return `[LIVE] SCROLL_MOUSE executed (${String(p.direction ?? "down")} ×${num(p.amount ?? 3)})`;
    case "DRAG_MOUSE":
      return `[LIVE] DRAG_MOUSE executed (${num(p.x)},${num(p.y)} → ${num(p.toX)},${num(p.toY)})`;
    case "TYPE_TEXT":
      return `[LIVE] TYPE_TEXT executed (${typeof p.text === "string" ? p.text.length : 0} chars)`;
    case "PRESS_KEY":
      return `[LIVE] PRESS_KEY executed (${String(p.key ?? "?")})`;
    case "HOTKEY": {
      const mods = Array.isArray(p.modifiers) ? p.modifiers.join("+") : "";
      return `[LIVE] HOTKEY executed (${mods ? `${mods}+` : ""}${String(p.key ?? "?")})`;
    }
    default:
      return `[LIVE] ${command.type} executed`;
  }
}

/**
 * Human-readable dry-run descriptions. Secret-bearing fields are NEVER echoed:
 * typed text and fill values are reported by length only.
 */
function describeDryRun(command: AgentCommand): string {
  const p = command.parameters as Record<string, unknown>;
  const num = (value: unknown): string => (typeof value === "number" ? String(value) : "?");
  switch (command.type) {
    case "MOVE_MOUSE":
      return `[DRY RUN] MOVE_MOUSE received → ${num(p.x)},${num(p.y)} (not moved)`;
    case "CLICK_MOUSE":
      return `[DRY RUN] CLICK_MOUSE received (${String(p.button ?? "left")} button, not clicked)`;
    case "DOUBLE_CLICK_MOUSE":
      return "[DRY RUN] DOUBLE_CLICK_MOUSE received (not clicked)";
    case "RIGHT_CLICK_MOUSE":
      return "[DRY RUN] RIGHT_CLICK_MOUSE received (not clicked)";
    case "SCROLL_MOUSE":
      return `[DRY RUN] SCROLL_MOUSE received (${String(p.direction ?? "down")} ×${num(p.amount ?? 3)}, not scrolled)`;
    case "DRAG_MOUSE":
      return `[DRY RUN] DRAG_MOUSE received (${num(p.x)},${num(p.y)} → ${num(p.toX)},${num(p.toY)}, not dragged)`;
    case "TYPE_TEXT":
      return `[DRY RUN] TYPE_TEXT received (${typeof p.text === "string" ? p.text.length : 0} chars, not typed)`;
    case "PRESS_KEY":
      return `[DRY RUN] PRESS_KEY received (${String(p.key ?? "?")}, not pressed)`;
    case "HOTKEY": {
      const mods = Array.isArray(p.modifiers) ? p.modifiers.join("+") : "";
      return `[DRY RUN] HOTKEY received (${mods ? `${mods}+` : ""}${String(p.key ?? "?")}, not pressed)`;
    }
    case "OPEN_URL":
      return `[DRY RUN] OPEN_URL received (${String(p.url ?? "?")}, not navigated)`;
    case "NEW_TAB":
      return `[DRY RUN] NEW_TAB received (${String(p.url ?? "about:blank")}, not opened)`;
    case "SWITCH_BROWSER_TAB":
      return `[DRY RUN] SWITCH_BROWSER_TAB received (${String(p.tabId ?? "?")}, not switched)`;
    case "RELOAD_TAB":
      return "[DRY RUN] RELOAD_TAB received (not reloaded)";
    case "CLOSE_TAB":
      return `[DRY RUN] CLOSE_TAB received (${String(p.tabId ?? "active")}, not closed)`;
    case "WAIT_FOR_PAGE":
      return `[DRY RUN] WAIT_FOR_PAGE received (${String(p.value ?? "load")}, not waited)`;
    case "WAIT_FOR_SELECTOR":
    case "CLICK_ELEMENT":
    case "FILL_INPUT": {
      const locator =
        (p.selectorType ?? "css") === "role"
          ? `role name="${String(p.name ?? "")}"`
          : `${String(p.selectorType ?? "css")} ${String(p.selector ?? p.name ?? "")}`;
      const extra = command.type === "FILL_INPUT" && typeof p.value === "string" ? ` (${p.value.length} chars, not filled)` : "";
      const verb = command.type === "FILL_INPUT" ? "not filled" : command.type === "CLICK_ELEMENT" ? "not clicked" : "not waited";
      return `[DRY RUN] ${command.type} received (${locator.trim()}, ${verb})${extra}`;
    }
    case "OPEN_APPLICATION":
      return `[DRY RUN] OPEN_APPLICATION received (${String(p.applicationId ?? "?")}, not launched)`;
    case "FOCUS_WINDOW":
    case "MINIMIZE_WINDOW":
    case "MAXIMIZE_WINDOW":
    case "CLOSE_WINDOW":
      return `[DRY RUN] ${command.type} received (${String(p.windowId ?? "focused window")}, no window change)`;
    case "WAIT":
    case "REPEAT":
    case "CONDITION":
    case "STOP":
      // Control-flow actions are interpreted by the server engine and should never
      // be dispatched; acknowledge honestly if one ever arrives.
      return `[DRY RUN] ${command.type} received (control-flow is handled by the server engine)`;
    default:
      return `[DRY RUN] ${command.type} received (not executed)`;
  }
}
