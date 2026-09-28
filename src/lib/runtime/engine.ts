import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, devices, workflowExecutions, workflows } from "@/db/schema";
import { log, publish } from "@/lib/events";
import { ApiError } from "@/lib/http";
import { describeActionSafe } from "@/lib/runtime/safe-log";
import {
  captureAction,
  controlsForDevice,
  createControl,
  ensureDeviceRuntime,
  getControl,
  pauseGate,
  releaseControl,
  runtimes,
  sleep,
  type DeviceLink,
} from "@/lib/runtime/host";
import { agentCommandSchema, validateParamsForType, ACTION_CATALOG, ERROR_MESSAGES, MAX_EXECUTION_MS } from "@autopilot/shared";
import type {
  ActionParams,
  ActionType,
  AgentCommand,
  AgentCommandResult,
  BrowserTab,
  DesktopWindow,
  ExecutionStep,
  WorkflowAction,
} from "@autopilot/shared";

/**
 * Workflow execution engine.
 *
 * Runs one execution per device at a time, sequentially, with per-action
 * delay / timeout / retry, cooperative pause + resume, cancellation and an
 * emergency stop that pre-empts everything. Control-flow actions (WAIT, REPEAT,
 * CONDITION, STOP) are interpreted here; every other action is translated into an
 * allowlisted `AgentCommand` and handed to the device link.
 */

const links = new Map<string, DeviceLink>();
const busyDevices = new Set<string>();

export function registerLink(deviceId: string, link: DeviceLink) {
  links.set(deviceId, link);
  const runtime = ensureDeviceRuntime(deviceId, link.kind === "SIMULATED" ? "" : "", link.kind);
  if (!runtime.userId) runtime.userId = link.kind === "SIMULATED" ? runtime.userId : runtime.userId;
}
export function unregisterLink(deviceId: string) {
  links.get(deviceId)?.close();
  links.delete(deviceId);
  const runtime = runtimes.get(deviceId);
  if (runtime) runtime.link = null;
}
export function getLink(deviceId: string): DeviceLink | undefined {
  return links.get(deviceId);
}
export function isDeviceOnline(deviceId: string) {
  return links.has(deviceId);
}
export function deviceHasActiveExecution(deviceId: string) {
  return busyDevices.has(deviceId) || controlsForDevice(deviceId).length > 0;
}

export interface DispatchOptions {
  userId: string;
  deviceId: string;
  type: ActionType;
  parameters: ActionParams;
  dryRun: boolean;
  timeoutMs?: number;
  executionId?: string;
  actionIndex?: number;
  actionTotal?: number;
  record?: boolean;
}

function buildCommand(opts: DispatchOptions, id = crypto.randomUUID()): AgentCommand {
  return {
    id,
    issuedAt: new Date().toISOString(),
    executionId: opts.executionId,
    actionIndex: opts.actionIndex,
    dryRun: opts.dryRun,
    type: opts.type,
    parameters: opts.parameters ?? {},
    timeoutMs: resolveCommandTimeoutMs(opts.type, opts.timeoutMs),
  };
}

/**
 * Timeout precedence: an explicit per-action timeout always wins; otherwise
 * control-flow actions get 30 s and everything else 15 s.
 */
export function resolveCommandTimeoutMs(type: ActionType, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  return ACTION_CATALOG[type]?.control ? 30_000 : 15_000;
}

/** Single ad-hoc command (mouse pad, keyboard pad, browser toolbar, window card…). */
export async function dispatchCommand(opts: DispatchOptions): Promise<AgentCommandResult> {
  const definition = ACTION_CATALOG[opts.type];
  if (!definition) throw new ApiError(400, `Command "${opts.type}" is not allowlisted`);
  const parsed = agentCommandSchema.safeParse(buildCommand(opts));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(422, issue?.message ?? ERROR_MESSAGES.INVALID_SELECTOR);
  }
  const paramError = validateParamsForType(opts.type, opts.parameters as Record<string, unknown>);
  if (paramError) throw new ApiError(422, paramError);

  const link = links.get(opts.deviceId);
  if (!link) throw new ApiError(409, ERROR_MESSAGES.AGENT_OFFLINE);

  if (opts.record !== false) captureAction(opts.deviceId, opts.type, opts.parameters);

  const timeout = Math.min(Math.max(parsed.data.timeoutMs, 250), 120_000);
  const result = await withTimeout(link.send(parsed.data), timeout, ERROR_MESSAGES.TIMEOUT);

  await log({
    userId: opts.userId,
    deviceId: opts.deviceId,
    executionId: opts.executionId ?? null,
    level: result.ok ? (opts.dryRun ? "DEBUG" : "SUCCESS") : "ERROR",
    message: `${opts.dryRun ? "[DRY RUN] " : ""}${describeActionSafe(opts.type, opts.parameters)} — ${result.message}`,
    actionType: opts.type,
    meta: { durationMs: result.durationMs, commandId: result.commandId },
  });
  return result;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(504, message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof ApiError ? error : new ApiError(500, "The device failed to run this command"));
      },
    );
  });
}

export interface StartWorkflowInput {
  userId: string;
  workflowId: string;
  deviceId: string;
  dryRun?: boolean;
  trigger?: "MANUAL" | "SCHEDULE" | "RECORDING" | "API";
}

export async function startWorkflow(input: StartWorkflowInput) {
  const [workflow] = await db.select().from(workflows).where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, input.userId)));
  if (!workflow) throw new ApiError(404, "Workflow not found");
  const [device] = await db.select().from(devices).where(eq(devices.id, input.deviceId));
  if (!device || device.userId !== input.userId) throw new ApiError(403, ERROR_MESSAGES.FORBIDDEN);
  const link = links.get(input.deviceId);
  if (!link) throw new ApiError(409, ERROR_MESSAGES.AGENT_OFFLINE);
  if (deviceHasActiveExecution(input.deviceId)) throw new ApiError(409, ERROR_MESSAGES.DEVICE_BUSY);

  const actions = (workflow.actions ?? []).filter((a) => a.enabled);
  if (!actions.length) throw new ApiError(422, "This workflow has no enabled actions");

  const dryRun = input.dryRun ?? workflow.isDryRun;
  const steps: ExecutionStep[] = actions.map((action, index) => ({
    index,
    actionId: action.id,
    actionType: action.type,
    status: "PENDING",
    message: "",
    durationMs: null,
    attempt: 0,
  }));

  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      workflowId: workflow.id,
      workflowName: workflow.name,
      userId: input.userId,
      deviceId: input.deviceId,
      status: "RUNNING",
      trigger: input.trigger ?? "MANUAL",
      dryRun,
      totalActions: actions.length,
      steps,
    })
    .returning();

  const control = createControl({
    executionId: execution.id,
    deviceId: input.deviceId,
    userId: input.userId,
    currentActionIndex: 0,
    stepsSnapshot: steps,
    skip: 0,
  });

  busyDevices.add(input.deviceId);
  link.setRecorder?.(true);
  updateAutomationState(input.deviceId, "RUNNING");

  publish(
    "workflow:started",
    { executionId: execution.id, workflowId: workflow.id, workflowName: workflow.name, deviceId: input.deviceId, message: dryRun ? "dry run" : "live" },
    input.userId,
  );
  await log({
    userId: input.userId,
    deviceId: input.deviceId,
    workflowId: workflow.id,
    executionId: execution.id,
    level: "INFO",
    message: `Workflow started — ${workflow.name}${dryRun ? " [DRY RUN]" : ""} on ${device.name}`,
  });

  // Fire and forget: the HTTP response returns immediately, the loop reports over SSE.
  void runLoop({ executionId: execution.id, userId: input.userId, deviceId: input.deviceId, workflowId: workflow.id, workflowName: workflow.name, actions, dryRun, control, link }).catch(async (error) => {
    await finalise(execution.id, input.userId, input.deviceId, workflow.id, workflow.name, "FAILED", (error as Error).message, control, link);
  });

  return { execution, dryRun, actionCount: actions.length };
}

interface LoopInput {
  executionId: string;
  userId: string;
  deviceId: string;
  workflowId: string;
  workflowName: string;
  actions: WorkflowAction[];
  dryRun: boolean;
  control: ReturnType<typeof createControl>;
  link: DeviceLink;
}

async function runLoop(input: LoopInput) {
  const { actions, control, link } = input;
  const startedAll = Date.now();
  const steps = [...control.stepsSnapshot] as ExecutionStep[];
  // Wire the live array into the control: finalise() persists stepsSnapshot,
  // so without this every run ends with the pristine all-PENDING timeline.
  attachSteps(control, steps);

  let index = 0;
  while (index < actions.length) {
    if (Date.now() - startedAll > MAX_EXECUTION_MS) {
      await finalise(input.executionId, input.userId, input.deviceId, input.workflowId, input.workflowName, "FAILED", ERROR_MESSAGES.TIMEOUT, control, link);
      return;
    }
    await pauseGate(control, control.abortController.signal);
    if (control.aborted) {
      await finalise(input.executionId, input.userId, input.deviceId, input.workflowId, input.workflowName, "STOPPED", "Cancelled by user", control, link);
      return;
    }

    const action = actions[index];
    control.currentActionIndex = index;
    publish(
      "action:started",
      { executionId: input.executionId, index, total: actions.length, actionId: action.id, actionType: action.type, message: describe(action) },
      input.userId,
    );
    updateStep(steps, index, { status: "RUNNING", attempt: 1 });
    await progress(input.executionId, index, steps);

    try {
      if (action.delay > 0) await sleep(action.delay, control.abortController.signal);
      await runAction(input, action, index, steps, link);
      updateStep(steps, index, { status: "COMPLETED", message: "ok" });
      publish(
        "action:completed",
        { executionId: input.executionId, index, total: actions.length, actionId: action.id, actionType: action.type, message: describe(action) },
        input.userId,
      );
    } catch (error) {
      const message = normaliseError(error);
      if (message === "ABORTED") {
        updateStep(steps, index, { status: "SKIPPED", message: "cancelled" });
        await progress(input.executionId, index, steps);
        await finalise(input.executionId, input.userId, input.deviceId, input.workflowId, input.workflowName, control.aborted ? "STOPPED" : "FAILED", message === "ABORTED" ? "Cancelled" : message, control, link);
        return;
      }
      if (message === STOP_SENTINEL) {
        // Explicit STOP: an authored early exit, not a failure. The run is
        // COMPLETE (remaining steps never ran and stay PENDING), which keeps it
        // distinct from STOPPED (external cancellation) and FAILED (error).
        updateStep(steps, index, { status: "COMPLETED", message: "stopped early by STOP action" });
        await progress(input.executionId, index, steps);
        publish(
          "action:completed",
          { executionId: input.executionId, index, total: actions.length, actionId: action.id, actionType: action.type, message: describe(action) },
          input.userId,
        );
        await log({
          userId: input.userId,
          deviceId: input.deviceId,
          workflowId: input.workflowId,
          executionId: input.executionId,
          level: "INFO",
          message: `Workflow stopped early by STOP action at step ${index + 1} of ${actions.length}`,
          actionType: "STOP",
        });
        await finalise(input.executionId, input.userId, input.deviceId, input.workflowId, input.workflowName, "COMPLETED", null, control, link);
        return;
      }
      updateStep(steps, index, { status: "FAILED", message });
      await progress(input.executionId, index, steps);
      publish(
        "action:failed",
        { executionId: input.executionId, index, total: actions.length, actionId: action.id, actionType: action.type, message },
        input.userId,
      );
      await log({
        userId: input.userId,
        deviceId: input.deviceId,
        workflowId: input.workflowId,
        executionId: input.executionId,
        level: "ERROR",
        message: `Action ${index + 1} failed — ${message}`,
        actionType: action.type,
      });
      if (!action.parameters.optional) {
        await finalise(input.executionId, input.userId, input.deviceId, input.workflowId, input.workflowName, "FAILED", `Step ${index + 1} (${action.type}): ${message}`, control, link);
        return;
      }
    }
    // a false CONDITION may have asked us to jump over the following actions
    const jump = Math.max(0, control.skip);
    control.skip = 0;
    index += 1 + Math.min(jump, actions.length - 1 - index);
    await progress(input.executionId, index, steps);
  }

  await finalise(input.executionId, input.userId, input.deviceId, input.workflowId, input.workflowName, "COMPLETED", null, control, link);
}

/** Executes one action, including control-flow semantics and retries. */
async function runAction(input: LoopInput, action: WorkflowAction, index: number, steps: ExecutionStep[], link: DeviceLink) {
  const definition = ACTION_CATALOG[action.type];
  const maxAttempts = Math.max(1, (action.retries ?? 0) + 1);

  if (definition?.control) {
    switch (action.type) {
      case "WAIT":
        await sleep(Math.min(action.parameters.milliseconds ?? 1000, 600_000), input.control.abortController.signal);
        return;
      case "STOP":
        throw new Error(STOP_SENTINEL);
      case "CONDITION": {
        const pass = evaluateCondition(action.parameters, input.deviceId);
        await log({
          userId: input.userId,
          deviceId: input.deviceId,
          executionId: input.executionId,
          level: pass ? "DEBUG" : "WARN",
          message: `${describe(action)} → ${pass ? "true" : "false"}`,
          actionType: "CONDITION",
        });
        if (!pass) {
          const skip = action.parameters.skipIfFalse ?? 0;
          for (let s = 1; s <= skip && index + s < input.actions.length; s += 1) {
            updateStep(steps, index + s, { status: "SKIPPED", message: "skipped by condition" });
          }
          // the loop reads this offset and jumps forward
          input.control.skip = skip;
        }
        return;
      }
      case "REPEAT": {
        const times = Math.min(Math.max(action.parameters.times ?? 1, 1), 200);
        const subActions = (action.parameters.subActions ?? []).filter((a) => a.enabled);
        for (let iteration = 0; iteration < times; iteration += 1) {
          if (input.control.aborted) throw new Error("ABORTED");
          await pauseGate(input.control, input.control.abortController.signal);
          for (const sub of subActions) {
            await runAction(input, { ...sub, retries: sub.retries ?? 0 }, index, steps, link);
          }
          await log({
            userId: input.userId,
            deviceId: input.deviceId,
            executionId: input.executionId,
            level: "DEBUG",
            message: `Repeat ${iteration + 1}/${times}`,
            actionType: "REPEAT",
          });
        }
        return;
      }
      default:
        return;
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    updateStep(steps, index, { attempt });
    try {
      const result = await dispatchCommand({
        userId: input.userId,
        deviceId: input.deviceId,
        type: action.type,
        parameters: action.parameters,
        dryRun: input.dryRun,
        timeoutMs: action.timeout,
        executionId: input.executionId,
        actionIndex: index,
        actionTotal: input.actions.length,
        record: false,
      });
      if (!result.ok) throw new Error(result.message);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message === "ABORTED" || input.control.aborted) throw lastError;
      if (attempt < maxAttempts) {
        await log({
          userId: input.userId,
          deviceId: input.deviceId,
          executionId: input.executionId,
          level: "WARN",
          message: `Retrying ${action.type} (attempt ${attempt + 1}/${maxAttempts})`,
          actionType: action.type,
        });
        await sleep(400, input.control.abortController.signal);
      }
    }
  }
  throw lastError ?? new Error("Action failed");
}

function evaluateCondition(params: ActionParams, deviceId: string): boolean {
  const runtime = runtimes.get(deviceId);
  const kind = params.conditionKind ?? "always";
  const operator = params.operator ?? "eq";
  const compare = params.compareValue;
  if (kind === "always") return true;
  if (!runtime) return false;
  let actual: number | string = "";
  if (kind === "mouseX") actual = runtime.state.mouse.x;
  else if (kind === "mouseY") actual = runtime.state.mouse.y;
  else if (kind === "activeApp") actual = runtime.state.activeWindow?.application ?? "";
  else if (kind === "browserTitle") actual = runtime.state.tabs.find((t: BrowserTab) => t.active)?.title ?? "";
  else if (kind === "browserUrl") actual = runtime.state.tabs.find((t: BrowserTab) => t.active)?.url ?? "";
  const numeric = typeof actual === "number";
  switch (operator) {
    case "gt":
      return Number(actual) > Number(compare ?? 0);
    case "lt":
      return Number(actual) < Number(compare ?? 0);
    case "contains":
      return String(actual).toLowerCase().includes(String(compare ?? "").toLowerCase());
    case "neq":
      return numeric ? Number(actual) !== Number(compare) : String(actual).toLowerCase() !== String(compare ?? "").toLowerCase();
    case "eq":
    default:
      return numeric ? Number(actual) === Number(compare) : String(actual).toLowerCase() === String(compare ?? "").toLowerCase();
  }
}

/** Log/SSE-safe description — never contains typed text, form values or URL secrets. */
export const STOP_SENTINEL = "__STOP__";

function describe(action: WorkflowAction) {
  return describeActionSafe(action.type, action.parameters ?? {});
}

function updateStep(steps: ExecutionStep[], index: number, patch: Partial<ExecutionStep>) {
  const existing = steps[index];
  if (!existing) return;
  steps[index] = { ...existing, ...patch, durationMs: patch.status === "COMPLETED" ? (existing.durationMs ?? 0) + 1 : existing.durationMs };
}

async function progress(executionId: string, index: number, steps: ExecutionStep[]) {
  await db
    .update(workflowExecutions)
    .set({ currentActionIndex: index, steps, updatedAt: new Date() })
    .where(eq(workflowExecutions.id, executionId));
}

async function finalise(
  executionId: string,
  userId: string,
  deviceId: string,
  workflowId: string,
  workflowName: string,
  status: "COMPLETED" | "FAILED" | "STOPPED",
  error: string | null,
  control: ReturnType<typeof createControl>,
  link: DeviceLink,
) {
  const steps = control.stepsSnapshot ?? [];
  const durationMs = Date.now() - control.startedAt;
  try {
    await db
      .update(workflowExecutions)
      .set({ status, finishedAt: new Date(), durationMs, error, steps, updatedAt: new Date() })
      .where(eq(workflowExecutions.id, executionId));
  } catch {
    /* the run is already over; a write failure must not surface as a crash */
  }
  busyDevices.delete(deviceId);
  updateAutomationState(deviceId, "IDLE");
  // Propagate cancellation to the agent ONLY when the run was cancelled
  // externally (user stop / emergency stop). COMPLETED and FAILED runs have no
  // in-flight work left, so signalling emergency-stop there would wrongly halt
  // the agent after every normal workflow.
  if (status === "STOPPED") link.emergencyStop();
  releaseControl(executionId);

  const event = status === "COMPLETED" ? "workflow:completed" : status === "FAILED" ? "workflow:failed" : "workflow:stopped";
  publish(event, { executionId, workflowId, workflowName, deviceId, message: error ?? undefined }, userId);
  await log({
    userId,
    deviceId,
    workflowId,
    executionId,
    level: status === "COMPLETED" ? "SUCCESS" : status === "FAILED" ? "ERROR" : "WARN",
    message: `Workflow ${status.toLowerCase()} — ${workflowName}${error ? ` (${error})` : ""}`,
    meta: { durationMs, actions: steps.length },
  });
}

function updateAutomationState(deviceId: string, automation: "RUNNING" | "IDLE" | "PAUSED") {
  const runtime = runtimes.get(deviceId);
  if (!runtime) return;
  runtime.state.automation = automation;
  publish("state:automation", { deviceId, automation }, runtime.userId);
}

export function pauseExecution(executionId: string) {
  const control = getControl(executionId);
  if (!control) throw new ApiError(409, "This execution is no longer running");
  control.status = "PAUSED";
  updateAutomationState(control.deviceId, "PAUSED");
  publish("workflow:paused", { executionId, deviceId: control.deviceId, workflowId: "", workflowName: "" }, control.userId);
  void db.update(workflowExecutions).set({ status: "PAUSED", updatedAt: new Date() }).where(eq(workflowExecutions.id, executionId)).execute().catch(() => undefined);
  void log({ userId: control.userId, deviceId: control.deviceId, executionId, level: "WARN", message: "Execution paused" });
  return control;
}

export function resumeExecution(executionId: string) {
  const control = getControl(executionId);
  if (!control) throw new ApiError(409, "This execution is no longer running");
  control.status = "RUNNING";
  updateAutomationState(control.deviceId, "RUNNING");
  publish("workflow:resumed", { executionId, deviceId: control.deviceId, workflowId: "", workflowName: "" }, control.userId);
  void db.update(workflowExecutions).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(workflowExecutions.id, executionId)).execute().catch(() => undefined);
  void log({ userId: control.userId, deviceId: control.deviceId, executionId, level: "INFO", message: "Execution resumed" });
  return control;
}

export function stopExecution(executionId: string, reason = "Stopped from the dashboard") {
  const control = getControl(executionId);
  if (!control) {
    void db.update(workflowExecutions).set({ status: "STOPPED", finishedAt: new Date(), error: reason }).where(eq(workflowExecutions.id, executionId)).execute().catch(() => undefined);
    return { stopped: 0 };
  }
  control.aborted = true;
  control.status = "STOPPING";
  control.abortController.abort();
  control.resumed?.();
  publish("workflow:stopping", { executionId, deviceId: control.deviceId, workflowId: "", workflowName: "", message: reason }, control.userId);
  void log({ userId: control.userId, deviceId: control.deviceId, executionId, level: "WARN", message: reason });
  return { stopped: 1 };
}

/** Emergency stop: every active execution on every device owned by the user. */
export async function emergencyStop(userId: string, deviceId?: string) {
  const targets = [...runtimes.values()].filter((r) => r.userId === userId && (!deviceId || r.deviceId === deviceId));
  const executions = [...(await activeIds(userId, deviceId))];
  let stopped = 0;
  for (const executionId of executions) {
    stopExecution(executionId, "EMERGENCY STOP");
    stopped += 1;
  }
  for (const runtime of targets) {
    links.get(runtime.deviceId)?.emergencyStop();
    busyDevices.delete(runtime.deviceId);
    updateAutomationState(runtime.deviceId, "IDLE");
  }
  publish("system:emergency-stop", { userId, deviceId: deviceId ?? null, stopped, at: new Date().toISOString() }, userId);
  await log({
    userId,
    deviceId: deviceId ?? null,
    level: "ERROR",
    message: `EMERGENCY STOP — ${stopped} execution${stopped === 1 ? "" : "s"} cancelled, device input queue flushed`,
  });
  return { stopped };
}

async function activeIds(userId: string, deviceId?: string) {
  const rows = await db
    .select({ id: workflowExecutions.id, deviceId: workflowExecutions.deviceId })
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.userId, userId), inArray(workflowExecutions.status, ["RUNNING", "PAUSED"])));
  return rows.filter((r) => !deviceId || r.deviceId === deviceId).map((r) => r.id);
}

/** True while any execution of the workflow is still alive (RUNNING or PAUSED). */
export async function workflowHasActiveExecution(workflowId: string): Promise<boolean> {
  const rows = await db
    .select({ id: workflowExecutions.id })
    .from(workflowExecutions)
    .where(and(eq(workflowExecutions.workflowId, workflowId), inArray(workflowExecutions.status, ["RUNNING", "PAUSED"])))
    .limit(1);
  return rows.length > 0;
}

/** Wires the execution's step snapshot so pause/resume/finalise can mutate it. */
export function attachSteps(control: ReturnType<typeof createControl>, steps: ExecutionStep[]) {
  (control as unknown as { stepsSnapshot: ExecutionStep[] }).stepsSnapshot = steps;
  (control as unknown as { skip: number }).skip = 0;
}

export function normaliseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) return "Unknown device error";
  if (message.includes(STOP_SENTINEL)) return STOP_SENTINEL;
  if (message === "ABORTED") return "ABORTED";
  if (error instanceof ApiError) return message;
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

export async function recentDeviceLogs(deviceId: string, limit = 50) {
  const rows = await db.select().from(activityLogs).where(eq(activityLogs.deviceId, deviceId)).limit(limit);
  return rows.reverse();
}

export function deviceWindows(deviceId: string): DesktopWindow[] {
  return runtimes.get(deviceId)?.state.windows ?? [];
}
export function deviceTabs(deviceId: string): BrowserTab[] {
  return runtimes.get(deviceId)?.state.tabs ?? [];
}
