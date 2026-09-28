import type {
  ActionType,
  AgentCommand,
  AgentCommandResult,
  BrowserTab,
  ExecutionStep,
  DesktopWindow,
  MousePosition,
  SystemState,
  WorkflowAction,
} from "@autopilot/shared";

/**
 * In-process runtime host.
 *
 * Every controllable device — whether it is the local simulated workstation or a
 * real Windows agent connected over the agent protocol — is represented by a
 * `DeviceRuntime` with a `DeviceLink` transport. The engine only ever talks to
 * links, which is what keeps the OS-specific automation behind an abstraction.
 *
 * State that must survive a restart (workflows, executions, logs, devices) lives in
 * Postgres. Live cursor position, window list and browser tabs are intentionally
 * in-memory: they are observations of a running machine, not application data.
 */

export interface DeviceLink {
  readonly kind: "SIMULATED" | "WINDOWS_AGENT";
  readonly deviceId: string;
  send(command: AgentCommand): Promise<AgentCommandResult>;
  emergencyStop(): void;
  setRecorder?(active: boolean): void;
  pushState?(): void;
  close(reason?: string): void;
}

export interface RecorderSession {
  id: string;
  userId: string;
  deviceId: string;
  startedAt: number;
  captured: WorkflowAction[];
  maskSensitive: boolean;
}

export interface DeviceRuntime {
  deviceId: string;
  userId: string;
  kind: DeviceLink["kind"];
  connectedAt: number | null;
  lastSeen: number;
  capabilities: string[];
  state: SystemState;
  link: DeviceLink | null;
  /** monotonic id used to correlate results for remote agents */
  seq: number;
}

const globalForHost = globalThis as typeof globalThis & {
  __autopilotRuntimes?: Map<string, DeviceRuntime>;
  __autopilotExecutions?: Map<string, ExecutionControl>;
  __autopilotRecorders?: Map<string, RecorderSession>;
};

export const runtimes: Map<string, DeviceRuntime> = (globalForHost.__autopilotRuntimes ??= new Map());
export const activeExecutions: Map<string, ExecutionControl> = (globalForHost.__autopilotExecutions ??= new Map());
export const recorderSessions: Map<string, RecorderSession> = (globalForHost.__autopilotRecorders ??= new Map());

function parseResolution(resolution: string): { w: number; h: number } {
  const [w, h] = resolution.split("x").map((v) => Number.parseInt(v, 10));
  return {
    w: Number.isFinite(w) && w > 0 ? w : 1920,
    h: Number.isFinite(h) && h > 0 ? h : 1080,
  };
}

export function emptyState(deviceId: string, resolution = "1920x1080"): SystemState {
  const { w, h } = parseResolution(resolution);
  return {
    deviceId,
    mouse: { x: Math.round(w / 2), y: Math.round(h / 2), screenW: w, screenH: h, at: Date.now() },
    activeWindow: null,
    windows: [],
    tabs: [],
    activeTabId: null,
    browserConnected: false,
    browserName: "Chromium",
    automation: "IDLE",
    typedBuffer: "",
  };
}

export function ensureDeviceRuntime(deviceId: string, userId: string, kind: DeviceLink["kind"]): DeviceRuntime {
  const existing = runtimes.get(deviceId);
  if (existing) return existing;
  const created: DeviceRuntime = {
    deviceId,
    userId,
    kind,
    connectedAt: null,
    lastSeen: Date.now(),
    capabilities: [],
    state: emptyState(deviceId),
    link: null,
    seq: 0,
  };
  runtimes.set(deviceId, created);
  return created;
}

export function onlineRuntimes(): DeviceRuntime[] {
  return [...runtimes.values()].filter((r) => r.link !== null);
}

export function runtimeForUser(userId: string): DeviceRuntime | undefined {
  const list = [...runtimes.values()].filter((r) => r.userId === userId && r.link);
  return list.find((r) => r.kind === "WINDOWS_AGENT") ?? list[0];
}

/** ── execution control (pause / resume / stop / emergency) ─────────────── */
export interface ExecutionControl {
  executionId: string;
  deviceId: string;
  userId: string;
  status: "RUNNING" | "PAUSED" | "STOPPING";
  aborted: boolean;
  abortController: AbortController;
  resumed: (() => void) | null;
  currentActionIndex: number;
  startedAt: number;
  /** live step list; persisted to Postgres as the execution timeline */
  stepsSnapshot: ExecutionStep[];
  /** number of following actions a false CONDITION told the engine to skip */
  skip: number;
}

export function createControl(exec: Omit<ExecutionControl, "aborted" | "abortController" | "resumed" | "status" | "startedAt">): ExecutionControl {
  const control: ExecutionControl = {
    ...exec,
    status: "RUNNING",
    aborted: false,
    abortController: new AbortController(),
    resumed: null,
    startedAt: Date.now(),
  };
  activeExecutions.set(exec.executionId, control);
  return control;
}

export function getControl(executionId: string): ExecutionControl | undefined {
  return activeExecutions.get(executionId);
}

export function releaseControl(executionId: string) {
  const control = activeExecutions.get(executionId);
  control?.resumed?.();
  activeExecutions.delete(executionId);
}

export function controlsForDevice(deviceId: string): ExecutionControl[] {
  return [...activeExecutions.values()].filter((c) => c.deviceId === deviceId);
}

/** Abortable sleep used for action delays, retries and pause gating. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("ABORTED"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("ABORTED"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pauseGate(control: ExecutionControl, signal: AbortSignal) {
  if (control.status !== "PAUSED") return;
  await new Promise<void>((resolve) => {
    control.resumed = resolve;
    const check = setInterval(() => {
      if (control.status !== "PAUSED" || signal.aborted) {
        clearInterval(check);
        control.resumed = null;
        resolve();
      }
    }, 120);
    signal.addEventListener("abort", () => {
      clearInterval(check);
      resolve();
    });
  });
}

/** ── recorder capture ──────────────────────────────────────────────────── */
export function startRecorder(userId: string, deviceId: string, maskSensitive = true): RecorderSession {
  const session: RecorderSession = {
    id: crypto.randomUUID(),
    userId,
    deviceId,
    startedAt: Date.now(),
    captured: [],
    maskSensitive,
  };
  recorderSessions.set(deviceId, session);
  return session;
}

export function stopRecorder(deviceId: string): RecorderSession | null {
  const session = recorderSessions.get(deviceId) ?? null;
  recorderSessions.delete(deviceId);
  return session;
}

export function activeRecorder(deviceId: string): RecorderSession | null {
  return recorderSessions.get(deviceId) ?? null;
}

const SECRET_FIELD = /(password|passwd|passcode|pin|secret|token|otp|credit)/i;

/**
 * Capture a dispatched command into the active recording. Password inputs are
 * never stored verbatim; they become a masked placeholder the user must edit.
 */
export function captureAction(deviceId: string, type: ActionType, parameters: WorkflowAction["parameters"], secondsElapsed?: number) {
  const session = recorderSessions.get(deviceId);
  if (!session) return;
  const params: WorkflowAction["parameters"] = { ...parameters };
  if (session.maskSensitive) {
    if (typeof params.text === "string" && SECRET_FIELD.test(params.text)) params.text = "••••••••";
    if (typeof params.value === "string" && params.selector && SECRET_FIELD.test(params.selector)) params.value = "••••••••";
    if (typeof params.value === "string" && params.selectorType === "label" && params.name && SECRET_FIELD.test(params.name)) params.value = "••••••••";
  }
  session.captured.push({
    id: crypto.randomUUID(),
    type,
    parameters: params,
    delay: secondsElapsed !== undefined ? Math.max(0, Math.round(secondsElapsed * 1000)) : 300,
    timeout: 15_000,
    retries: 0,
    enabled: true,
  });
}

/** ── helpers used by the UI layer ──────────────────────────────────────── */
export function readMouse(state: SystemState): MousePosition {
  return state.mouse;
}

export function summariseTabs(tabs: BrowserTab[]): string {
  return tabs.find((t) => t.active)?.title ?? "no active tab";
}

export function summariseWindows(windows: DesktopWindow[]): string {
  return windows.find((w) => w.isFocused)?.application ?? "no focused window";
}
