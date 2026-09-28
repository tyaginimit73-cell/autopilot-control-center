import { db } from "@/db";
import { activityLogs } from "@/db/schema";
import { LOG_BUFFER_SIZE, MOUSE_REPORT_INTERVAL_MS } from "@autopilot/shared";
import type { ActivityLog, LogLevel, ActionType, MousePosition } from "@autopilot/shared";

/**
 * Realtime fan-out for the dashboard.
 *
 * The dashboard subscribes with `EventSource`/`fetch` to `GET /api/stream`, which
 * pumps these envelopes. Event names are identical to the Socket.IO namespaces used
 * in the standalone Node deployment (agent:connected, workflow:started, action:started,
 * mouse:position, browser:updated, window:updated, log:created …) so switching the
 * transport to socket.io only replaces this file and the client hook.
 */

export interface Envelope {
  event: string;
  payload: unknown;
  userId: string | null;
  at: string;
  id: number;
}

type Listener = (envelope: Envelope) => void;

const globalForBus = globalThis as typeof globalThis & {
  __autopilotBus?: { listeners: Set<Listener>; buffer: Envelope[]; seq: number };
};

const bus = (globalForBus.__autopilotBus ??= { listeners: new Set<Listener>(), buffer: [] as Envelope[], seq: 0 });

export function publish(event: string, payload: unknown, userId: string | null = null) {
  const envelope: Envelope = { event, payload, userId, at: new Date().toISOString(), id: ++bus.seq };
  bus.buffer.push(envelope);
  if (bus.buffer.length > LOG_BUFFER_SIZE) bus.buffer.splice(0, bus.buffer.length - LOG_BUFFER_SIZE);
  for (const listener of bus.listeners) {
    if (envelope.userId === null || envelope.userId === userId || listener.length === 0) {
      try {
        listener(envelope);
      } catch {
        /* a dead stream must never break execution */
      }
    }
  }
}

export function subscribe(userId: string | null, listener: Listener): () => void {
  const wrapped: Listener = (envelope) => {
    if (userId === null || envelope.userId === null || envelope.userId === userId) listener(envelope);
  };
  bus.listeners.add(wrapped);
  return () => bus.listeners.delete(wrapped);
}

export function replayBuffer(userId: string | null, sinceId = 0): Envelope[] {
  return bus.buffer.filter((e) => e.id > sinceId && (userId === null || e.userId === userId || e.userId === null));
}

export function bufferLength() {
  return bus.buffer.length;
}

export function lastEventId(): number {
  return bus.seq;
}

/** High-frequency cursor telemetry is dropped, not queued. */
const lastMouseEmit = new Map<string, number>();
export function publishMousePosition(deviceId: string, userId: string, position: MousePosition) {
  const now = position.at;
  const last = lastMouseEmit.get(deviceId) ?? 0;
  if (now - last < MOUSE_REPORT_INTERVAL_MS) return;
  lastMouseEmit.set(deviceId, now);
  publish("mouse:position", { deviceId, ...position }, userId);
}

export interface LogInput {
  userId: string | null;
  deviceId?: string | null;
  workflowId?: string | null;
  executionId?: string | null;
  level?: LogLevel;
  message: string;
  actionType?: ActionType | null;
  meta?: Record<string, unknown>;
}

/** Audit + console line: buffered for the live console, persisted for history. */
export async function log(input: LogInput): Promise<ActivityLog> {
  const entry: ActivityLog = {
    id: crypto.randomUUID(),
    userId: input.userId,
    deviceId: input.deviceId ?? null,
    workflowId: input.workflowId ?? null,
    executionId: input.executionId ?? null,
    level: input.level ?? "INFO",
    message: input.message,
    actionType: input.actionType ?? null,
    createdAt: new Date().toISOString(),
    meta: input.meta,
  };
  publish("log:created", entry, input.userId);
  try {
    await db.insert(activityLogs).values({
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      workflowId: input.workflowId ?? null,
      executionId: input.executionId ?? null,
      level: entry.level,
      message: entry.message,
      actionType: entry.actionType,
      meta: entry.meta ?? null,
    });
  } catch (error) {
    // Logging must never take down an execution.
    console.error("activity log persist failed", (error as Error)?.message);
  }
  return entry;
}

export function formatSSE(envelope: Envelope): string {
  return `id: ${envelope.id}\nevent: ${envelope.event}\ndata: ${JSON.stringify(envelope.payload)}\n\n`;
}
