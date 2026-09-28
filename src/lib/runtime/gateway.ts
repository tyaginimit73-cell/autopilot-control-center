import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { log, publish } from "@/lib/events";
import { captureAction, ensureDeviceRuntime, runtimes, type DeviceLink } from "@/lib/runtime/host";
import { registerLink, unregisterLink } from "@/lib/runtime/engine";
import { AGENT_VERSION, ERROR_MESSAGES, HEARTBEAT_TIMEOUT_MS } from "@autopilot/shared";
import type { ActionParams, ActionType, AgentCommand, AgentCommandResult } from "@autopilot/shared";

/**
 * Local agent transport.
 *
 * A Windows agent connects with its device token and keeps a long-lived SSE
 * stream open (`GET /api/agent/events`). Commands are pushed down that stream;
 * results come back over `POST /api/agent/result`. Heartbeats, window lists,
 * browser tab lists and recorder captures use the same channel.
 *
 * In the Socket.IO deployment this file is replaced by `server/src/socket/agent.ts`
 * — the DeviceLink interface, the command allowlist and every payload shape stay
 * identical, which is exactly why the dashboard and engine never know the difference.
 */

interface AgentSocket {
  deviceId: string;
  userId: string;
  write: (event: string, payload: unknown) => void;
  closed: boolean;
}

interface PendingEntry {
  deviceId: string;
  resolve: (r: AgentCommandResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const globalForGateway = globalThis as typeof globalThis & {
  __autopilotAgentSockets?: Map<string, AgentSocket>;
  __autopilotAgentPending?: Map<string, PendingEntry>;
};

const sockets = (globalForGateway.__autopilotAgentSockets ??= new Map<string, AgentSocket>());
const pending = (globalForGateway.__autopilotAgentPending ??= new Map<string, PendingEntry>());

class RemoteAgentLink implements DeviceLink {
  readonly kind = "WINDOWS_AGENT" as const;
  constructor(readonly deviceId: string, private socket: AgentSocket, private userId: string) {}

  send(command: AgentCommand): Promise<AgentCommandResult> {
    if (this.socket.closed) return Promise.reject(new Error(ERROR_MESSAGES.AGENT_OFFLINE));
    return new Promise<AgentCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(command.id);
        resolve({ commandId: command.id, ok: false, message: ERROR_MESSAGES.TIMEOUT, durationMs: command.timeoutMs });
      }, Math.max(command.timeoutMs, 1_000));
      pending.set(command.id, { deviceId: this.deviceId, resolve, reject, timer });
      this.socket.write("command", command);
    });
  }

  emergencyStop() {
    if (!this.socket.closed) this.socket.write("emergency-stop", { at: Date.now() });
  }

  setRecorder(active: boolean) {
    if (!this.socket.closed) this.socket.write(active ? "recorder:start" : "recorder:stop", { at: Date.now() });
  }

  pushState() {
    if (!this.socket.closed) this.socket.write("state:request", {});
  }

  close() {
    // Device-scoped cleanup: disconnecting this device must never disturb
    // in-flight commands belonging to other devices.
    for (const [id, entry] of pending) {
      if (entry.deviceId !== this.deviceId) continue;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(ERROR_MESSAGES.AGENT_OFFLINE));
    }
  }
}

export const agentProtocolVersion = AGENT_VERSION;

export function isAgentConnected(deviceId: string) {
  return sockets.has(deviceId);
}

export function connectedAgentIds() {
  return [...sockets.keys()];
}

/** Register the downstream stream for a device and mark it ONLINE. */
export async function openAgentStream(deviceId: string, userId: string, write: (event: string, payload: unknown) => void) {
  const previous = sockets.get(deviceId);
  if (previous) {
    previous.closed = true;
    unregisterLink(deviceId);
  }

  const socket: AgentSocket = { deviceId, userId, write, closed: false };
  sockets.set(deviceId, socket);
  const runtime = ensureDeviceRuntime(deviceId, userId, "WINDOWS_AGENT");
  runtime.link = new RemoteAgentLink(deviceId, socket, userId);
  runtime.connectedAt = Date.now();
  runtime.lastSeen = Date.now();
  registerLink(deviceId, runtime.link);

  await db.update(devices).set({ status: "ONLINE", lastSeen: new Date(), agentVersion: AGENT_VERSION, updatedAt: new Date() }).where(eq(devices.id, deviceId));
  publish("agent:connected", { deviceId, deviceName: runtime.state.browserName ?? "Windows PC" }, userId);
  await log({ userId, deviceId, level: "SUCCESS", message: "Agent connected — real OS automation is now available on this device" });

  return () => {
    socket.closed = true;
    if (sockets.get(deviceId) === socket) sockets.delete(deviceId);
    unregisterLink(deviceId);
    const rt = ensureDeviceRuntime(deviceId, userId, "WINDOWS_AGENT");
    rt.link = null;
    rt.connectedAt = null;
    void markOffline(deviceId, userId, "socket closed");
  };
}

export async function markOffline(deviceId: string, userId: string, reason: string) {
  await db.update(devices).set({ status: "OFFLINE", updatedAt: new Date() }).where(eq(devices.id, deviceId));
  publish("agent:disconnected", { deviceId, reason }, userId);
  await log({ userId, deviceId, level: "WARN", message: `Agent disconnected — ${reason}` });
}

export async function touchHeartbeat(deviceId: string, extra?: { activeWindow?: string; browserTab?: string }) {
  const runtime = ensureDeviceRuntime(deviceId, "", "WINDOWS_AGENT");
  runtime.lastSeen = Date.now();
  await db.update(devices).set({ lastSeen: new Date(), status: "ONLINE", updatedAt: new Date() }).where(eq(devices.id, deviceId));
  if (extra?.activeWindow) {
    const current = runtime.state.activeWindow;
    runtime.state.activeWindow = {
      id: current?.id ?? "win-agent",
      application: extra.activeWindow,
      title: extra.browserTab ?? extra.activeWindow,
      processName: current?.processName ?? "unknown",
      isFocused: true,
      state: "normal",
    };
    publish("window:updated", { deviceId, windows: runtime.state.windows, activeWindow: runtime.state.activeWindow }, runtime.userId);
  }
}

export function resolveResult(deviceId: string, commandId: string, result: AgentCommandResult) {
  const entry = pending.get(commandId);
  // Ownership check: a device may only resolve its own commands.
  if (!entry || entry.deviceId !== deviceId) return false;
  clearTimeout(entry.timer);
  pending.delete(commandId);
  entry.resolve(result);
  return true;
}

/** Upstream state reports from the agent (windows, tabs, pointer). */
export async function applyAgentState(
  deviceId: string,
  patch: {
    mouse?: { x: number; y: number };
    windows?: unknown[];
    tabs?: unknown[];
    activeTabId?: string | null;
    browserConnected?: boolean;
    browserName?: string;
    typedBuffer?: string;
    automation?: "RUNNING" | "IDLE" | "PAUSED";
  },
) {
  const runtime = runtimesFor(deviceId);
  if (!runtime) return;
  const { state } = runtime;
  if (patch.mouse) {
    state.mouse = { ...state.mouse, ...patch.mouse, at: Date.now() };
    publish("mouse:position", { deviceId, ...state.mouse }, runtime.userId);
  }
  if (Array.isArray(patch.windows)) {
    state.windows = patch.windows as typeof state.windows;
    state.activeWindow = state.windows.find((w) => w.isFocused) ?? null;
    publish("window:updated", { deviceId, windows: state.windows, activeWindow: state.activeWindow }, runtime.userId);
  }
  if (Array.isArray(patch.tabs)) {
    state.tabs = patch.tabs as typeof state.tabs;
    state.activeTabId = patch.activeTabId ?? state.activeTabId;
    state.browserConnected = patch.browserConnected ?? state.browserConnected;
    state.browserName = patch.browserName ?? state.browserName;
    publish(
      "browser:updated",
      { deviceId, tabs: state.tabs, activeTabId: state.activeTabId, browserConnected: state.browserConnected, browserName: state.browserName },
      runtime.userId,
    );
  }
  // `typedBuffer` is deliberately NOT ingested: raw keystroke content must never
  // travel from an agent into server memory, let alone the dashboard. The field
  // stays accepted by the schema for backward compatibility and is ignored here.
  if (patch.automation) state.automation = patch.automation;
}

function runtimesFor(deviceId: string) {
  return runtimes.get(deviceId);
}

/** Recorder events pushed by the agent's global input hooks. */
export async function applyRecorderEvent(deviceId: string, event: { type: ActionType; parameters: ActionParams; gapMs?: number }) {
  captureAction(deviceId, event.type, event.parameters, (event.gapMs ?? 0) / 1000);
}

export async function staleDevices() {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  // NULL-safe: a NULL lastSeen satisfies the stale predicate in SQL instead of
  // being filtered out before the JS fallback could see it. Simulated devices
  // are excluded: they are in-process (no heartbeats by design) and the health
  // monitor already owns their ONLINE/OFFLINE lifecycle.
  const rows = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.status, "ONLINE"),
        eq(devices.kind, "WINDOWS_AGENT"),
        or(isNull(devices.lastSeen), lt(devices.lastSeen, cutoff)),
      ),
    );
  return rows.map((row) => ({ id: row.id, userId: row.userId }));
}

export { devices };
