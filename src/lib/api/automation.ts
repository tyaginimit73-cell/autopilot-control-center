import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, applicationProfiles, devices as devicesTable, userSettings, workflowExecutions, workflows } from "@/db/schema";
import { ApiError, json } from "@/lib/http";
import { log, publish, replayBuffer } from "@/lib/events";
import {
  browserActSchema,
  browserElementSchema,
  browserOpenSchema,
  desktopFocusSchema,
  ERROR_MESSAGES,
  keyboardCommandSchema,
  mouseCommandSchema,
  settingsSchema,
} from "@autopilot/shared";
import type { ActionType, SettingsInput } from "@autopilot/shared";
import { dispatchCommand, emergencyStop, getLink, isDeviceOnline } from "@/lib/runtime/engine";
import { activeRecorder, ensureDeviceRuntime, runtimeForUser, startRecorder, stopRecorder } from "@/lib/runtime/host";
import { ensureSimulatedDevice } from "@/lib/runtime/index";
import type { Ctx } from "@/lib/api/router";

/** Every browser/desktop endpoint also accepts these three optional control fields. */
const withDevice = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...shape,
    deviceId: z.string().min(1).optional(),
    dryRun: z.boolean().optional(),
    confirm: z.boolean().optional(),
  });

export async function loadSettings(userId: string): Promise<SettingsInput> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  const defaults = settingsSchema.parse({});
  if (!row) {
    await db.insert(userSettings).values({ userId, ...defaults }).onConflictDoNothing();
    return defaults;
  }
  return {
    defaultActionDelayMs: row.defaultActionDelayMs,
    defaultActionTimeoutMs: row.defaultActionTimeoutMs,
    defaultRetries: row.defaultRetries,
    dryRunByDefault: row.dryRunByDefault,
    emergencyShortcut: row.emergencyShortcut,
    mouseReportIntervalMs: row.mouseReportIntervalMs,
    theme: row.theme === "GRAPHITE" ? "GRAPHITE" : "MIDNIGHT",
    notifyOnFailure: row.notifyOnFailure,
    notifyOnComplete: row.notifyOnComplete,
    confirmDestructive: row.confirmDestructive,
  };
}

async function resolveDevice(ctx: Ctx, explicit?: string) {
  const candidate = explicit ?? ctx.url.searchParams.get("deviceId") ?? undefined;
  if (candidate) {
    const [row] = await db.select().from(devicesTable).where(and(eq(devicesTable.id, candidate), eq(devicesTable.userId, ctx.user.id)));
    if (!row) throw new ApiError(404, "Device not found");
    return row;
  }
  const runtime = runtimeForUser(ctx.user.id);
  if (runtime) {
    const [row] = await db.select().from(devicesTable).where(eq(devicesTable.id, runtime.deviceId));
    if (row) return row;
  }
  const created = await ensureSimulatedDevice(ctx.user.id);
  const [row] = await db.select().from(devicesTable).where(eq(devicesTable.id, created.id));
  if (!row) throw new ApiError(409, ERROR_MESSAGES.AGENT_OFFLINE);
  return row;
}

type Loose = Record<string, unknown>;

/** Shared manual-control path: settings → device → allowlisted command → audit log. */
async function run(ctx: Ctx, input: Loose, type: ActionType) {
  const settings = await loadSettings(ctx.user.id);
  const device = await resolveDevice(ctx, (input.deviceId as string | undefined) ?? undefined);
  if (settings.confirmDestructive && (type === "CLOSE_TAB" || type === "CLOSE_WINDOW") && !input.confirm) {
    throw new ApiError(409, "This action closes something on your machine — confirm it and try again.");
  }
  const payload: Loose = { ...input };
  delete payload.deviceId;
  delete payload.dryRun;
  delete payload.confirm;
  const parameters = (payload.parameters as Loose) ?? payload;
  const result = await dispatchCommand({
    userId: ctx.user.id,
    deviceId: device.id,
    type,
    parameters: parameters as never,
    dryRun: typeof input.dryRun === "boolean" ? input.dryRun : settings.dryRunByDefault,
    timeoutMs: settings.defaultActionTimeoutMs,
  });
  if (!result.ok) throw new ApiError(400, result.message);
  return { device, result };
}

export const automationHandlers = {
  /* ── browser ────────────────────────────────────────────────────────────── */
  async tabs(ctx: Ctx) {
    const device = await resolveDevice(ctx, ctx.url.searchParams.get("deviceId") ?? undefined);
    const runtime = ensureDeviceRuntime(device.id, ctx.user.id, device.kind);
    return json({
      deviceId: device.id,
      deviceName: device.name,
      agentConnected: isDeviceOnline(device.id),
      browserConnected: runtime.state.browserConnected,
      browserName: runtime.state.browserName,
      activeTabId: runtime.state.activeTabId,
      tabs: runtime.state.tabs,
      offlineHint: isDeviceOnline(device.id) ? null : ERROR_MESSAGES.BROWSER_UNAVAILABLE,
    });
  },

  async openUrl(ctx: Ctx) {
    const input = await ctx.body(withDevice(browserOpenSchema.shape));
    const out = await run(ctx, input as Loose, "OPEN_URL");
    return json({ ok: true, result: out.result, deviceId: out.device.id });
  },

  async switchTab(ctx: Ctx) {
    const input = await ctx.body(withDevice({ tabId: z.string().min(1).max(64) }));
    const out = await run(ctx, input as Loose, "SWITCH_BROWSER_TAB");
    return json({ ok: true, result: out.result });
  },

  async closeTab(ctx: Ctx) {
    const input = await ctx.body(withDevice({ tabId: z.string().min(1).max(64).optional() }));
    const out = await run(ctx, input as Loose, "CLOSE_TAB");
    return json({ ok: true, result: out.result });
  },

  async browserAct(ctx: Ctx) {
    const input = await ctx.body(withDevice(browserActSchema.shape));
    const map: Record<string, ActionType> = { reload: "RELOAD_TAB", close: "CLOSE_TAB", activate: "SWITCH_BROWSER_TAB" };
    const type = map[String(input.action)];
    if (!type) throw new ApiError(400, "That browser verb is not part of the command allowlist");
    const out = await run(ctx, input as Loose, type);
    return json({ ok: true, result: out.result });
  },

  async browserElement(ctx: Ctx) {
    const input = await ctx.body(withDevice(browserElementSchema.shape));
    const map: Record<string, ActionType> = { click: "CLICK_ELEMENT", fill: "FILL_INPUT", waitFor: "WAIT_FOR_SELECTOR" };
    const out = await run(ctx, input as Loose, map[String(input.kind)]);
    return json({ ok: true, result: out.result });
  },

  /* ── desktop ────────────────────────────────────────────────────────────── */
  async windows(ctx: Ctx) {
    const device = await resolveDevice(ctx, ctx.url.searchParams.get("deviceId") ?? undefined);
    const runtime = ensureDeviceRuntime(device.id, ctx.user.id, device.kind);
    const profiles = await db
      .select()
      .from(applicationProfiles)
      .where(and(eq(applicationProfiles.userId, ctx.user.id), eq(applicationProfiles.enabled, true)));
    return json({
      deviceId: device.id,
      deviceName: device.name,
      kind: device.kind,
      agentConnected: isDeviceOnline(device.id),
      automation: runtime.state.automation,
      mouse: runtime.state.mouse,
      activeWindow: runtime.state.activeWindow,
      windows: runtime.state.windows,
      profiles,
    });
  },

  async desktopFocus(ctx: Ctx) {
    const input = await ctx.body(withDevice(desktopFocusSchema.shape));
    const map: Record<string, ActionType> = {
      focus: "FOCUS_WINDOW",
      minimize: "MINIMIZE_WINDOW",
      maximize: "MAXIMIZE_WINDOW",
      close: "CLOSE_WINDOW",
    };
    const out = await run(ctx, input as Loose, map[String(input.operation)]);
    return json({ ok: true, result: out.result });
  },

  async mouse(ctx: Ctx) {
    const input = await ctx.body(withDevice(mouseCommandSchema.shape));
    const out = await run(ctx, input as Loose, String(input.type) as ActionType);
    const runtime = ensureDeviceRuntime(out.device.id, ctx.user.id, out.device.kind);
    return json({ ok: true, result: out.result, mouse: runtime.state.mouse });
  },

  async keyboard(ctx: Ctx) {
    const input = await ctx.body(withDevice(keyboardCommandSchema.shape));
    const out = await run(ctx, input as Loose, String(input.type) as ActionType);
    return json({ ok: true, result: out.result });
  },

  async openApplication(ctx: Ctx) {
    const input = await ctx.body(withDevice({ applicationId: z.string().min(1).max(128) }));
    const out = await run(ctx, input as Loose, "OPEN_APPLICATION");
    return json({ ok: true, result: out.result });
  },

  /* ── recorder ───────────────────────────────────────────────────────────── */
  async recorderState(ctx: Ctx) {
    const device = await resolveDevice(ctx);
    const session = activeRecorder(device.id);
    return json({
      recording: Boolean(session),
      deviceId: device.id,
      startedAt: session ? new Date(session.startedAt).toISOString() : null,
      captured: session?.captured ?? [],
      hint: session
        ? null
        : "Recording captures every action routed to the agent. A connected Windows agent additionally streams OS-level input hooks.",
    });
  },

  async recorderStart(ctx: Ctx) {
    const input = await ctx.body(withDevice({ maskSensitive: z.boolean().default(true) }));
    const device = await resolveDevice(ctx, input.deviceId);
    startRecorder(ctx.user.id, device.id, input.maskSensitive);
    getLink(device.id)?.setRecorder?.(true);
    await log({ userId: ctx.user.id, deviceId: device.id, level: "WARN", message: `Recording started on ${device.name}` });
    publish("recorder:started", { deviceId: device.id }, ctx.user.id);
    return json({ ok: true, startedAt: new Date().toISOString() });
  },

  async recorderStop(ctx: Ctx) {
    const input = await ctx.body(withDevice({ createWorkflow: z.boolean().default(true), name: z.string().max(120).optional() }));
    const device = await resolveDevice(ctx, input.deviceId);
    const session = stopRecorder(device.id);
    getLink(device.id)?.setRecorder?.(false);
    if (!session) throw new ApiError(409, "Nothing is being recorded on that device");
    const captured = session.captured;
    publish("recorder:stopped", { deviceId: device.id, count: captured.length }, ctx.user.id);
    if (!captured.length) {
      await log({ userId: ctx.user.id, deviceId: device.id, level: "WARN", message: "Recording stopped — no supported actions were captured" });
      return json({ ok: true, captured, workflow: null, message: "No supported actions were captured during this session" });
    }
    let workflow: { id: string; name: string; actionCount: number } | null = null;
    if (input.createWorkflow) {
      const actions = captured.map((action, index) => ({ ...action, delay: index === 0 ? 0 : action.delay }));
      const [created] = await db
        .insert(workflows)
        .values({
          userId: ctx.user.id,
          name: input.name?.trim() || `Recorded ${new Date().toLocaleString()}`,
          description: `Generated by the recorder: ${actions.length} captured action(s). Edit before replaying.`,
          actions,
          status: "DRAFT",
          isDryRun: true,
        })
        .returning();
      workflow = { id: created.id, name: created.name, actionCount: actions.length };
      await log({
        userId: ctx.user.id,
        deviceId: device.id,
        workflowId: created.id,
        level: "SUCCESS",
        message: `Recording saved as workflow "${created.name}" (${actions.length} actions)`,
      });
    }
    return json({ ok: true, captured, workflow });
  },

  async recorderDiscard(ctx: Ctx) {
    const device = await resolveDevice(ctx);
    stopRecorder(device.id);
    getLink(device.id)?.setRecorder?.(false);
    publish("recorder:stopped", { deviceId: device.id, count: 0 }, ctx.user.id);
    return json({ ok: true });
  },

  /* ── system ─────────────────────────────────────────────────────────────── */
  async status(ctx: Ctx) {
    const device = await resolveDevice(ctx);
    const runtime = ensureDeviceRuntime(device.id, ctx.user.id, device.kind);
    const all = await db.select().from(devicesTable).where(eq(devicesTable.userId, ctx.user.id));
    const [running] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.userId, ctx.user.id), eq(workflowExecutions.status, "RUNNING")));
    return json({
      backend: { state: "online", startedAt: new Date(STARTED_AT).toISOString(), uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000), version: "1.0.0" },
      socket: { state: "online", transport: "sse", bufferedEvents: replayBuffer(ctx.user.id).length },
      agent: {
        deviceId: device.id,
        deviceName: device.name,
        kind: device.kind,
        state: isDeviceOnline(device.id) ? "connected" : "disconnected",
        lastSeen: new Date(runtime.lastSeen).toISOString(),
        capabilities: runtime.capabilities,
        platform: device.platform,
        agentVersion: device.agentVersion,
        displayResolution: device.displayResolution,
      },
      browser: {
        state: runtime.state.browserConnected ? "connected" : "disconnected",
        name: runtime.state.browserName,
        tabs: runtime.state.tabs.length,
        activeTab: runtime.state.tabs.find((t) => t.active)?.title ?? null,
      },
      device: { name: device.name, platform: device.platform, os: device.platform },
      automation: { state: runtime.state.automation.toLowerCase(), currentAction: runtime.state.automation === "IDLE" ? null : "executing" },
      mouse: runtime.state.mouse,
      activeWindow: runtime.state.activeWindow,
      typedBuffer: runtime.state.typedBuffer,
      devices: all.map((row) => ({ id: row.id, name: row.name, status: row.status, kind: row.kind, connected: isDeviceOnline(row.id) })),
      runningExecutions: running?.count ?? 0,
    });
  },

  async stats(ctx: Ctx) {
    const [counts] = await db
      .select({
        workflows: sql<number>`(select count(*)::int from "workflows" where user_id = ${ctx.user.id})`,
        executions: sql<number>`(select count(*)::int from "workflow_executions" where user_id = ${ctx.user.id})`,
        successful: sql<number>`(select count(*)::int from "workflow_executions" where user_id = ${ctx.user.id} and status = 'COMPLETED')`,
        failed: sql<number>`(select count(*)::int from "workflow_executions" where user_id = ${ctx.user.id} and status = 'FAILED')`,
        devices: sql<number>`(select count(*)::int from "devices" where user_id = ${ctx.user.id})`,
        onlineDevices: sql<number>`(select count(*)::int from "devices" where user_id = ${ctx.user.id} and status = 'ONLINE')`,
      })
      .from(sql`(select 1) as x`);
    const recent = await db
      .select({ status: workflowExecutions.status, startedAt: workflowExecutions.startedAt, durationMs: workflowExecutions.durationMs })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.userId, ctx.user.id))
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(40);
    return json({
      stats: counts ?? { workflows: 0, executions: 0, successful: 0, failed: 0, devices: 0, onlineDevices: 0 },
      recent: recent.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() })),
    });
  },

  async logs(ctx: Ctx) {
    const limit = Math.min(Number.parseInt(ctx.url.searchParams.get("limit") ?? "150", 10) || 150, 500);
    const level = ctx.url.searchParams.get("level");
    const clauses = [eq(activityLogs.userId, ctx.user.id)];
    if (level) clauses.push(eq(activityLogs.level, level as never));
    const rows = await db.select().from(activityLogs).where(and(...clauses)).orderBy(desc(activityLogs.createdAt)).limit(limit);
    return json({
      logs: rows.reverse().map((row) => ({
        id: row.id,
        level: row.level,
        message: row.message,
        actionType: row.actionType,
        executionId: row.executionId,
        deviceId: row.deviceId,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  },

  async clearLogs(ctx: Ctx) {
    await db.delete(activityLogs).where(eq(activityLogs.userId, ctx.user.id));
    return json({ ok: true });
  },

  async settings(ctx: Ctx) {
    return json({ settings: await loadSettings(ctx.user.id) });
  },

  async saveSettings(ctx: Ctx) {
    const input = await ctx.body(settingsSchema);
    await db
      .insert(userSettings)
      .values({ userId: ctx.user.id, ...input })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...input, updatedAt: new Date() } });
    publish("settings:updated", { deviceId: null, ...input }, ctx.user.id);
    await log({
      userId: ctx.user.id,
      level: "INFO",
      message: `Settings saved — default dry run ${input.dryRunByDefault ? "on" : "off"}, emergency shortcut ${input.emergencyShortcut}`,
    });
    return json({ settings: input });
  },

  async emergencyStop(ctx: Ctx) {
    const deviceId = ctx.url.searchParams.get("deviceId") ?? undefined;
    const result = await emergencyStop(ctx.user.id, deviceId);
    return json({ ok: true, ...result });
  },
};

const STARTED_AT = Date.now();
