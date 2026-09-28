import { validate, type AgentCommand, type Profile } from "../security/allowlist.js";
import type { AgentStore } from "../state/store.js";
import type { ControlPlaneClient } from "../transport/client.js";

/**
 * Phase-1 command executor: DRY-RUN ONLY.
 *
 * Pipeline: parse → allowlist-validate → halt/dedup checks → dry-run gate →
 * honest result → POST /api/agent/result (retried, idempotent).
 *
 * There are intentionally no driver imports in this file. A command with
 * `dryRun: false` can therefore never produce a physical effect: it is rejected
 * with a clear "not supported in Phase 1" result. `DRY_RUN=1` in the agent env
 * additionally forces every command down the dry-run path even if the server
 * asked for a live run.
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
  log?: (message: string) => void;
}

const RESULT_MESSAGE_LIMIT = 500;

function truncate(message: string): string {
  return message.length > RESULT_MESSAGE_LIMIT ? `${message.slice(0, RESULT_MESSAGE_LIMIT - 1)}…` : message;
}

export class CommandExecutor {
  /** Serial queue: at most one command "executes" at a time. */
  private tail: Promise<void> = Promise.resolve();
  private epoch = 0;

  constructor(private readonly opts: ExecutorOptions) {}

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
   * Emergency stop: cancel everything still queued, halt the executor, and mark
   * state IDLE. In Phase 1 there is no physical automation to stop, so this only
   * affects queued/reported dry-run work. A reconnect (fresh `hello`) clears the
   * halt; until then every command is rejected with a clear reason.
   */
  emergencyStop(reason: string) {
    this.epoch += 1;
    this.opts.store.onEmergencyStop(reason);
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

    // 4. Dry-run gate — the Phase-1 safety invariant. No drivers exist, so a live
    // command is answered honestly instead of executed.
    if (this.opts.forceDryRun && !command.dryRun) {
      this.opts.store.stats.commandsRejected += 1;
      await this.deliver(
        fail(command.id, `refused: agent runs with DRY_RUN=1, but the server requested a live ${command.type} run`),
      );
      return;
    }
    if (!command.dryRun) {
      this.opts.store.stats.commandsRejected += 1;
      await this.deliver(
        fail(
          command.id,
          `unsupported in Phase 1: live ${command.type} execution needs OS drivers that are not installed yet (re-send with dryRun:true)`,
        ),
      );
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
