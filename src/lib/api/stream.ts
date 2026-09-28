import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices as devicesTable } from "@/db/schema";
import { ApiError, json } from "@/lib/http";
import { formatSSE, publish, replayBuffer, subscribe } from "@/lib/events";
import {
  agentProtocolVersion,
  applyAgentState,
  applyRecorderEvent,
  openAgentStream,
  resolveResult,
  touchHeartbeat,
} from "@/lib/runtime/gateway";
import { ensureDeviceRuntime, runtimes } from "@/lib/runtime/host";
import { isDeviceOnline } from "@/lib/runtime/engine";
import { deviceHandlers } from "@/lib/api/devices";
import { SSE_KEEPALIVE_MS } from "@autopilot/shared";
import type { Ctx } from "@/lib/api/router";

const encoder = new TextEncoder();

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform, must-revalidate",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  } as Record<string, string>;
}



export const streamHandlers = {
  /** Live dashboard feed: statuses, workflow/action events, throttled pointer, logs. */
  async dashboard(ctx: Ctx) {
    const userId = ctx.user.id;
    const since = Number.parseInt(ctx.req.headers.get("last-event-id") ?? ctx.url.searchParams.get("since") ?? "0", 10) || 0;
    const list = [...runtimes.values()].filter((r) => r.userId === userId);
    const runtime = list.find((r) => r.kind === "WINDOWS_AGENT") ?? list[0] ?? null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };
        write(
          formatSSE({
            id: 0,
            event: "stream:ready",
            userId,
            at: new Date().toISOString(),
            payload: {
              userId,
              deviceId: runtime?.deviceId ?? null,
              automation: runtime?.state.automation ?? "IDLE",
              mouse: runtime?.state.mouse ?? null,
              agentOnline: runtime ? isDeviceOnline(runtime.deviceId) : false,
            },
          }),
        );
        for (const envelope of replayBuffer(userId, since)) write(formatSSE(envelope));

        const unsubscribe = subscribe(userId, (envelope) => write(formatSSE(envelope)));
        const keepAlive = setInterval(() => write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
        keepAlive.unref?.();
        ctx.req.signal.addEventListener("abort", () => {
          closed = true;
          clearInterval(keepAlive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* noop */
          }
        });
      },
    });

    return new Response(stream, { headers: sseHeaders() });
  },

  /* ── agent protocol ─────────────────────────────────────────────────────── */
  async agentPair(ctx: Ctx) {
    return deviceHandlers.agentPair(ctx);
  },

  /** Downstream command stream for a connected local agent. */
  async agentEvents(ctx: Ctx) {
    const agent = ctx.agent;
    if (!agent) throw new ApiError(401, "Device token required");
    const [device] = await db.select().from(devicesTable).where(eq(devicesTable.id, agent.deviceId));
    if (!device) throw new ApiError(404, "Device not found");
    ensureDeviceRuntime(device.id, agent.userId, "WINDOWS_AGENT");

    let detach: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };
        const push = (event: string, payload: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        detach = await openAgentStream(device.id, agent.userId, push);
        push("hello", {
          deviceId: device.id,
          protocol: agentProtocolVersion,
          heartbeatSeconds: 5,
          capabilities: device.capabilities,
          note: "Only allowlisted commands are sent here. Emergency stop pre-empts the queue.",
        });
        const keepAlive = setInterval(() => write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
        keepAlive.unref?.();
        ctx.req.signal.addEventListener("abort", () => {
          closed = true;
          clearInterval(keepAlive);
          detach?.();
          try {
            controller.close();
          } catch {
            /* noop */
          }
        });
      },
      cancel() {
        detach?.();
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  },

  async agentHeartbeat(ctx: Ctx) {
    const agent = ctx.agent;
    if (!agent) throw new ApiError(401, "Device token required");
    const input = await ctx.body(
      z.object({ status: z.enum(["ONLINE", "ERROR"]).default("ONLINE"), activeWindow: z.string().max(200).optional(), browserTab: z.string().max(200).optional() }),
    );
    await touchHeartbeat(agent.deviceId, input);
    publish("agent:heartbeat", { deviceId: agent.deviceId, at: new Date().toISOString(), status: input.status }, agent.userId);
    return json({ ok: true, serverTime: Date.now() });
  },

  async agentResult(ctx: Ctx) {
    const agent = ctx.agent;
    if (!agent) throw new ApiError(401, "Device token required");
    const input = await ctx.body(
      z.object({
        commandId: z.string().min(1).max(64),
        ok: z.boolean(),
        message: z.string().max(600),
        durationMs: z.number().int().min(0).max(600_000).default(0),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    );
    const matched = resolveResult(agent.deviceId, input.commandId, input);
    publish("agent:result", { deviceId: agent.deviceId, ...input }, agent.userId);
    return json({ ok: true, matched });
  },

  async agentState(ctx: Ctx) {
    const agent = ctx.agent;
    if (!agent) throw new ApiError(401, "Device token required");
    const input = await ctx.body(
      z.object({
        mouse: z.object({ x: z.number().int().min(0).max(8192), y: z.number().int().min(0).max(8192) }).optional(),
        windows: z.array(z.unknown()).max(80).optional(),
        tabs: z.array(z.unknown()).max(80).optional(),
        activeTabId: z.string().max(64).nullable().optional(),
        browserConnected: z.boolean().optional(),
        browserName: z.string().max(80).optional(),
        typedBuffer: z.string().max(400).optional(),
        automation: z.enum(["RUNNING", "IDLE", "PAUSED"]).optional(),
      }),
    );
    await applyAgentState(agent.deviceId, input);
    return json({ ok: true });
  },

  async agentRecorderEvent(ctx: Ctx) {
    const agent = ctx.agent;
    if (!agent) throw new ApiError(401, "Device token required");
    const input = await ctx.body(
      z.object({
        type: z.string().max(40),
        parameters: z.record(z.string(), z.unknown()).default({}),
        gapMs: z.number().int().min(0).max(120_000).optional(),
      }),
    );
    const { ACTION_CATALOG } = await import("@autopilot/shared");
    const type = String(input.type) as keyof typeof ACTION_CATALOG;
    if (!ACTION_CATALOG[type]) throw new ApiError(422, "Recorder emitted an action type that is not allowlisted");
    await applyRecorderEvent(agent.deviceId, { type, parameters: input.parameters as never, gapMs: input.gapMs });
    publish("recorder:event", { deviceId: agent.deviceId, type, count: 1 }, agent.userId);
    return json({ ok: true });
  },
};


