import type { NextRequest } from "next/server";
import type { z } from "zod";
import { ApiError, currentUser, errorResponse, json, rateLimitFromRequest, readJson, type Session } from "@/lib/http";
import { authHandlers } from "@/lib/api/auth";
import { deviceHandlers } from "@/lib/api/devices";
import { workflowHandlers } from "@/lib/api/workflows";
import { automationHandlers } from "@/lib/api/automation";
import { streamHandlers } from "@/lib/api/stream";

/**
 * Control-plane router.
 *
 * The deployment spec lists ~30 REST endpoints. They are implemented as a
 * declarative table here and mounted through `src/app/api/[...path]/route.ts`
 * so that one compiled handler serves the whole surface (identical URLs,
 * identical payloads, identical auth rules).
 */

export interface Ctx {
  req: NextRequest;
  url: URL;
  params: Record<string, string>;
  user: Session;
  body: <T>(schema: z.ZodType<T>) => Promise<T>;
  query: <T>(schema: z.ZodType<T>) => Promise<T>;
  /** present on /api/agent/* routes after token verification */
  agent?: { deviceId: string; userId: string };
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth?: "required" | "optional" | "agent";
  bucket?: "auth" | "automation" | "general";
  handler: (ctx: Ctx) => Promise<Response>;
}

export const routes: Route[] = [
  // ── authentication ──────────────────────────────────────────────────────
  { method: "POST", path: "/api/auth/register", auth: "optional", bucket: "auth", handler: authHandlers.register },
  { method: "POST", path: "/api/auth/login", auth: "optional", bucket: "auth", handler: authHandlers.login },
  { method: "POST", path: "/api/auth/logout", auth: "optional", handler: authHandlers.logout },
  { method: "GET", path: "/api/auth/me", auth: "optional", handler: authHandlers.me },

  // ── devices + pairing ───────────────────────────────────────────────────
  { method: "GET", path: "/api/devices", handler: deviceHandlers.list },
  { method: "POST", path: "/api/devices/pair", handler: deviceHandlers.createPairing },
  { method: "POST", path: "/api/devices/manual", handler: deviceHandlers.createManual },
  { method: "PATCH", path: "/api/devices/:id", handler: deviceHandlers.update },
  { method: "DELETE", path: "/api/devices/:id", handler: deviceHandlers.remove },
  { method: "POST", path: "/api/devices/:id/rotate", handler: deviceHandlers.rotate },
  { method: "GET", path: "/api/devices/:id/state", handler: deviceHandlers.state },
  { method: "GET", path: "/api/applications", handler: deviceHandlers.applications },
  { method: "POST", path: "/api/applications", handler: deviceHandlers.createApplication },
  { method: "PATCH", path: "/api/applications/:id", handler: deviceHandlers.updateApplication },
  { method: "DELETE", path: "/api/applications/:id", handler: deviceHandlers.removeApplication },

  // ── workflows ───────────────────────────────────────────────────────────
  { method: "GET", path: "/api/workflows", handler: workflowHandlers.list },
  { method: "POST", path: "/api/workflows", handler: workflowHandlers.create },
  { method: "GET", path: "/api/workflows/:id", handler: workflowHandlers.get },
  { method: "PUT", path: "/api/workflows/:id", handler: workflowHandlers.update },
  { method: "PATCH", path: "/api/workflows/:id", handler: workflowHandlers.update },
  { method: "DELETE", path: "/api/workflows/:id", handler: workflowHandlers.remove },
  { method: "POST", path: "/api/workflows/:id/start", bucket: "automation", handler: workflowHandlers.start },
  { method: "POST", path: "/api/workflows/validate", handler: workflowHandlers.validate },
  { method: "POST", path: "/api/workflows/duplicate", handler: workflowHandlers.duplicate },

  // ── executions / history ────────────────────────────────────────────────
  { method: "GET", path: "/api/executions", handler: workflowHandlers.executions },
  { method: "GET", path: "/api/executions/:id", handler: workflowHandlers.execution },
  { method: "POST", path: "/api/executions/:id/pause", bucket: "automation", handler: workflowHandlers.pause },
  { method: "POST", path: "/api/executions/:id/resume", bucket: "automation", handler: workflowHandlers.resume },
  { method: "POST", path: "/api/executions/:id/stop", bucket: "automation", handler: workflowHandlers.stop },

  // ── schedules ───────────────────────────────────────────────────────────
  { method: "GET", path: "/api/schedules", handler: workflowHandlers.schedules },
  { method: "POST", path: "/api/schedules", handler: workflowHandlers.createSchedule },
  { method: "PUT", path: "/api/schedules/:id", handler: workflowHandlers.updateSchedule },
  { method: "PATCH", path: "/api/schedules/:id", handler: workflowHandlers.updateSchedule },
  { method: "DELETE", path: "/api/schedules/:id", handler: workflowHandlers.removeSchedule },
  { method: "POST", path: "/api/schedules/:id/run-now", bucket: "automation", handler: workflowHandlers.runScheduleNow },

  // ── browser control ─────────────────────────────────────────────────────
  { method: "GET", path: "/api/browser/tabs", handler: automationHandlers.tabs },
  { method: "POST", path: "/api/browser/open", bucket: "automation", handler: automationHandlers.openUrl },
  { method: "POST", path: "/api/browser/switch", bucket: "automation", handler: automationHandlers.switchTab },
  { method: "POST", path: "/api/browser/close", bucket: "automation", handler: automationHandlers.closeTab },
  { method: "POST", path: "/api/browser/act", bucket: "automation", handler: automationHandlers.browserAct },
  { method: "POST", path: "/api/browser/element", bucket: "automation", handler: automationHandlers.browserElement },

  // ── desktop control ─────────────────────────────────────────────────────
  { method: "GET", path: "/api/desktop/windows", handler: automationHandlers.windows },
  { method: "POST", path: "/api/desktop/focus", bucket: "automation", handler: automationHandlers.desktopFocus },
  { method: "POST", path: "/api/desktop/mouse", bucket: "automation", handler: automationHandlers.mouse },
  { method: "POST", path: "/api/desktop/keyboard", bucket: "automation", handler: automationHandlers.keyboard },
  { method: "POST", path: "/api/desktop/open-application", bucket: "automation", handler: automationHandlers.openApplication },

  // ── recorder ────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/recorder/state", handler: automationHandlers.recorderState },
  { method: "POST", path: "/api/recorder/start", bucket: "automation", handler: automationHandlers.recorderStart },
  { method: "POST", path: "/api/recorder/stop", bucket: "automation", handler: automationHandlers.recorderStop },
  { method: "POST", path: "/api/recorder/discard", handler: automationHandlers.recorderDiscard },

  // ── system, logs, settings ──────────────────────────────────────────────
  { method: "GET", path: "/api/system/status", handler: automationHandlers.status },
  { method: "GET", path: "/api/system/stats", handler: automationHandlers.stats },
  { method: "POST", path: "/api/system/emergency-stop", bucket: "automation", handler: automationHandlers.emergencyStop },
  { method: "GET", path: "/api/logs", handler: automationHandlers.logs },
  { method: "DELETE", path: "/api/logs", handler: automationHandlers.clearLogs },
  { method: "GET", path: "/api/settings", handler: automationHandlers.settings },
  { method: "PUT", path: "/api/settings", handler: automationHandlers.saveSettings },

  // ── realtime ────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/stream", handler: streamHandlers.dashboard },

  // ── agent protocol (device-token authenticated) ─────────────────────────
  { method: "POST", path: "/api/agent/pair", auth: "optional", bucket: "auth", handler: streamHandlers.agentPair },
  { method: "GET", path: "/api/agent/events", auth: "agent", handler: streamHandlers.agentEvents },
  { method: "POST", path: "/api/agent/heartbeat", auth: "agent", handler: streamHandlers.agentHeartbeat },
  { method: "POST", path: "/api/agent/result", auth: "agent", handler: streamHandlers.agentResult },
  { method: "POST", path: "/api/agent/state", auth: "agent", handler: streamHandlers.agentState },
  { method: "POST", path: "/api/agent/recorder-event", auth: "agent", handler: streamHandlers.agentRecorderEvent },
];



function match(pattern: string, pathname: string) {
  const p = pattern.split("/").filter(Boolean);
  const s = pathname.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export async function handleApi(req: NextRequest, method: Route["method"]): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = match(route.path, pathname);
    if (!params) continue;
    try {
      rateLimitFromRequest(req, route.bucket ?? "general");
      const user = await currentUser(req);
      if (route.auth === "agent") {
        const agent = await resolveAgent(req);
        const ctx: Ctx = {
          req,
          url,
          params,
          user: { id: agent.userId } as Session,
          agent,
          body: (schema) => readJson(req, schema),
          query: (schema) => readQuery(req, schema),
        };
        return await route.handler(ctx);
      }
      if (route.auth !== "optional" && !user) throw new ApiError(401, "Sign in to control this workspace");
      const ctx: Ctx = {
        req,
        url,
        params,
        user: user as Session,
        body: (schema) => readJson(req, schema),
        query: (schema) => readQuery(req, schema),
      };
      return await route.handler(ctx);
    } catch (error) {
      return errorResponse(error);
    }
  }
  return json({ error: "Not found", code: "NOT_FOUND", path: pathname }, { status: 404 });
}

async function resolveAgent(req: NextRequest) {
  const { verifyDeviceToken } = await import("@/lib/api/agent-auth");
  return verifyDeviceToken(req);
}

async function readQuery<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid query");
  return parsed.data as T;
}
