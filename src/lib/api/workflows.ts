import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, schedules as schedulesTable, workflowExecutions, workflows } from "@/db/schema";
import { ApiError, json } from "@/lib/http";
import {
  ERROR_MESSAGES,
  scheduleSchema,
  startWorkflowSchema,
  workflowActionSchema,
  workflowUpsertSchema,
} from "@autopilot/shared";
import type { WorkflowAction } from "@autopilot/shared";
import {
  deviceHasActiveExecution,
  emergencyStop,
  pauseExecution,
  resumeExecution,
  startWorkflow,
  stopExecution,
} from "@/lib/runtime/engine";
import { ensureSimulatedDevice } from "@/lib/runtime/index";
import { runtimeForUser } from "@/lib/runtime/host";
import { computeNextRun } from "@/lib/runtime/scheduler";
import { loadSettings } from "@/lib/api/automation";
import type { Ctx } from "@/lib/api/router";

const idParam = z.string().min(1);
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), status: z.string().optional(), workflowId: z.string().optional() });

function serialise(row: typeof workflows.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    actions: (row.actions ?? []) as WorkflowAction[],
    status: row.status,
    isDryRun: row.isDryRun,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serialiseExecution(row: typeof workflowExecutions.$inferSelect) {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    userId: row.userId,
    deviceId: row.deviceId,
    status: row.status,
    trigger: row.trigger,
    dryRun: row.dryRun,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs,
    currentActionIndex: row.currentActionIndex,
    totalActions: row.totalActions,
    error: row.error,
    steps: (row.steps ?? []) as unknown[],
  };
}

export const workflowHandlers = {
  async list(ctx: Ctx) {
    const rows = await db.select().from(workflows).where(eq(workflows.userId, ctx.user.id)).orderBy(desc(workflows.updatedAt));
    const recent = await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.userId, ctx.user.id))
      .orderBy(desc(workflowExecutions.startedAt))
      .limit(120);
    const byWorkflow = new Map<string, typeof recent[number]>();
    for (const execution of recent) {
      if (execution.workflowId && !byWorkflow.has(execution.workflowId)) byWorkflow.set(execution.workflowId, execution);
    }
    return json({
      workflows: rows.map((row) => ({
        ...serialise(row),
        lastRun: byWorkflow.get(row.id)
          ? { id: byWorkflow.get(row.id)!.id, status: byWorkflow.get(row.id)!.status, startedAt: byWorkflow.get(row.id)!.startedAt.toISOString(), durationMs: byWorkflow.get(row.id)!.durationMs, dryRun: byWorkflow.get(row.id)!.dryRun }
          : null,
      })),
    });
  },

  async get(ctx: Ctx) {
    const [row] = await db.select().from(workflows).where(and(eq(workflows.id, ctx.params.id), eq(workflows.userId, ctx.user.id)));
    if (!row) throw new ApiError(404, "Workflow not found");
    const runs = await db.select().from(workflowExecutions).where(eq(workflowExecutions.workflowId, row.id)).orderBy(desc(workflowExecutions.startedAt)).limit(20);
    return json({ workflow: serialise(row), executions: runs.map(serialiseExecution) });
  },

  async create(ctx: Ctx) {
    const input = await ctx.body(workflowUpsertSchema);
    const [row] = await db
      .insert(workflows)
      .values({ userId: ctx.user.id, name: input.name, description: input.description, actions: input.actions, status: input.status, isDryRun: input.isDryRun })
      .returning();
    return json({ workflow: serialise(row) }, { status: 201 });
  },

  async update(ctx: Ctx) {
    const input = await ctx.body(workflowUpsertSchema);
    const [existing] = await db.select().from(workflows).where(and(eq(workflows.id, ctx.params.id), eq(workflows.userId, ctx.user.id)));
    if (!existing) throw new ApiError(404, "Workflow not found");
    const [row] = await db
      .update(workflows)
      .set({
        name: input.name,
        description: input.description,
        actions: input.actions,
        status: input.status,
        isDryRun: input.isDryRun,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, ctx.params.id))
      .returning();
    return json({ workflow: serialise(row) });
  },

  async remove(ctx: Ctx) {
    const [existing] = await db.select().from(workflows).where(and(eq(workflows.id, ctx.params.id), eq(workflows.userId, ctx.user.id)));
    if (!existing) throw new ApiError(404, "Workflow not found");
    if (deviceHasActiveExecution(existing.id)) throw new ApiError(409, "Stop the running execution before deleting this workflow");
    await db.delete(workflows).where(eq(workflows.id, ctx.params.id));
    return json({ ok: true });
  },

  /** Dry validation endpoint used by the builder's "check" button. */
  async validate(ctx: Ctx) {
    const payload = await ctx.body(z.object({ actions: z.array(z.unknown()).max(200) }));
    const issues: { index: number; message: string }[] = [];
    payload.actions.forEach((action, index) => {
      const parsed = workflowActionSchema.safeParse(action);
      if (!parsed.success) {
        for (const issue of parsed.error.issues.slice(0, 2)) issues.push({ index, message: issue.message });
      }
    });
    return json({ valid: issues.length === 0, issues, actionCount: payload.actions.length });
  },

  async duplicate(ctx: Ctx) {
    const input = await ctx.body(z.object({ workflowId: idParam }));
    const [source] = await db.select().from(workflows).where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, ctx.user.id)));
    if (!source) throw new ApiError(404, "Workflow not found");
    const actions = (source.actions ?? []).map((action) => ({ ...action, id: crypto.randomUUID() }));
    const [copy] = await db
      .insert(workflows)
      .values({ userId: ctx.user.id, name: `${source.name} copy`, description: source.description, actions, status: "DRAFT", isDryRun: source.isDryRun })
      .returning();
    return json({ workflow: serialise(copy) }, { status: 201 });
  },

  async start(ctx: Ctx) {
    const input = await ctx.body(startWorkflowSchema.partial().extend({ deviceId: z.string().min(1).optional() }));
    const settings = await loadSettings(ctx.user.id);
    let deviceId = input.deviceId ?? runtimeForUser(ctx.user.id)?.deviceId;
    if (!deviceId) {
      const device = await ensureSimulatedDevice(ctx.user.id);
      deviceId = device.id;
    }
    const result = await startWorkflow({
      userId: ctx.user.id,
      workflowId: ctx.params.id,
      deviceId,
      dryRun: input.dryRun ?? settings.dryRunByDefault,
      trigger: "MANUAL",
    });
    return json({ executionId: result.execution.id, dryRun: result.dryRun, actionCount: result.actionCount }, { status: 202 });
  },

  /* ── executions ─────────────────────────────────────────────────────────── */
  async executions(ctx: Ctx) {
    const query = (await ctx.query(listQuery)) as { limit: number; status?: string; workflowId?: string };
    const clauses = [eq(workflowExecutions.userId, ctx.user.id)];
    if (query.status) clauses.push(eq(workflowExecutions.status, query.status as never));
    if (query.workflowId) clauses.push(eq(workflowExecutions.workflowId, query.workflowId));
    const rows = await db.select().from(workflowExecutions).where(and(...clauses)).orderBy(desc(workflowExecutions.startedAt)).limit(query.limit);
    return json({ executions: rows.map(serialiseExecution) });
  },

  async execution(ctx: Ctx) {
    const [row] = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.id, ctx.params.id), eq(workflowExecutions.userId, ctx.user.id)));
    if (!row) throw new ApiError(404, "Execution not found");
    const logs = await db.select().from(activityLogs).where(eq(activityLogs.executionId, row.id)).orderBy(activityLogs.createdAt).limit(500);
    return json({
      execution: serialiseExecution(row),
      logs: logs.map((entry) => ({
        id: entry.id,
        level: entry.level,
        message: entry.message,
        actionType: entry.actionType,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  },

  async pause(ctx: Ctx) {
    await assertOwnedExecution(ctx.params.id, ctx.user.id);
    pauseExecution(ctx.params.id);
    return json({ ok: true, status: "PAUSED" });
  },

  async resume(ctx: Ctx) {
    await assertOwnedExecution(ctx.params.id, ctx.user.id);
    resumeExecution(ctx.params.id);
    return json({ ok: true, status: "RUNNING" });
  },

  async stop(ctx: Ctx) {
    await assertOwnedExecution(ctx.params.id, ctx.user.id);
    stopExecution(ctx.params.id, "Stopped from the dashboard");
    return json({ ok: true, status: "STOPPING" });
  },

  /* ── schedules ──────────────────────────────────────────────────────────── */
  async schedules(ctx: Ctx) {
    const rows = await db.select().from(schedulesTable).where(eq(schedulesTable.userId, ctx.user.id)).orderBy(desc(schedulesTable.createdAt));
    const workflowRows = await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(eq(workflows.userId, ctx.user.id));
    const names = new Map(workflowRows.map((w) => [w.id, w.name]));
    return json({
      schedules: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        workflowId: row.workflowId,
        workflowName: names.get(row.workflowId) ?? "Workflow",
        deviceId: row.deviceId,
        name: row.name,
        frequency: row.frequency,
        timeOfDay: row.timeOfDay,
        dayOfWeek: row.dayOfWeek,
        intervalMinutes: row.intervalMinutes,
        cron: row.cron,
        runAt: row.runAt ? row.runAt.toISOString() : null,
        enabled: row.enabled,
        misfirePolicy: row.misfirePolicy,
        dryRun: row.dryRun,
        nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
        lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      })),
    });
  },

  async createSchedule(ctx: Ctx) {
    const input = await ctx.body(scheduleSchema);
    const [workflow] = await db.select().from(workflows).where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, ctx.user.id)));
    if (!workflow) throw new ApiError(404, "Workflow not found");
    if (input.frequency === "CRON" && !input.cron) throw new ApiError(422, "A cron expression is required for custom schedules");
    if (input.frequency === "ONCE" && !input.runAt) throw new ApiError(422, "Pick a date and time for a one-off run");
    const row = {
      frequency: input.frequency,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek ?? null,
      intervalMinutes: input.intervalMinutes ?? null,
      cron: input.cron ?? null,
      lastRunAt: null,
      nextRunAt: null,
    } as never;
    const nextRunAt = computeNextRun(row as never);
    if (input.frequency !== "ONCE" && !nextRunAt) throw new ApiError(422, "This schedule will never fire — check the time or cron expression");
    const [created] = await db
      .insert(schedulesTable)
      .values({
        userId: ctx.user.id,
        workflowId: input.workflowId,
        deviceId: input.deviceId,
        name: input.name,
        frequency: input.frequency,
        timeOfDay: input.timeOfDay,
        dayOfWeek: input.dayOfWeek ?? null,
        intervalMinutes: input.intervalMinutes ?? null,
        cron: input.cron ?? null,
        runAt: input.runAt ? new Date(input.runAt) : null,
        enabled: input.enabled,
        misfirePolicy: input.misfirePolicy,
        dryRun: input.dryRun,
        nextRunAt,
      })
      .returning();
    return json({ schedule: created, warning: nextRunAt ? null : ERROR_MESSAGES.AGENT_OFFLINE }, { status: 201 });
  },

  async updateSchedule(ctx: Ctx) {
    const input = await ctx.body(scheduleSchema.partial());
    const [existing] = await db.select().from(schedulesTable).where(and(eq(schedulesTable.id, ctx.params.id), eq(schedulesTable.userId, ctx.user.id)));
    if (!existing) throw new ApiError(404, "Schedule not found");
    const merged = { ...existing, ...input, runAt: input.runAt ? new Date(input.runAt) : existing.runAt } as never;
    const nextRunAt = input.enabled === false ? null : computeNextRun(merged);
    const [row] = await db
      .update(schedulesTable)
      .set({
        name: input.name ?? existing.name,
        timeOfDay: input.timeOfDay ?? existing.timeOfDay,
        dayOfWeek: input.dayOfWeek === undefined ? existing.dayOfWeek : input.dayOfWeek,
        intervalMinutes: input.intervalMinutes === undefined ? existing.intervalMinutes : input.intervalMinutes,
        cron: input.cron === undefined ? existing.cron : input.cron,
        frequency: input.frequency ?? existing.frequency,
        enabled: input.enabled ?? existing.enabled,
        misfirePolicy: input.misfirePolicy ?? existing.misfirePolicy,
        dryRun: input.dryRun ?? existing.dryRun,
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(schedulesTable.id, existing.id))
      .returning();
    return json({ schedule: row });
  },

  async removeSchedule(ctx: Ctx) {
    const [existing] = await db.select().from(schedulesTable).where(and(eq(schedulesTable.id, ctx.params.id), eq(schedulesTable.userId, ctx.user.id)));
    if (!existing) throw new ApiError(404, "Schedule not found");
    await db.delete(schedulesTable).where(eq(schedulesTable.id, existing.id));
    return json({ ok: true });
  },

  async runScheduleNow(ctx: Ctx) {
    const [existing] = await db.select().from(schedulesTable).where(and(eq(schedulesTable.id, ctx.params.id), eq(schedulesTable.userId, ctx.user.id)));
    if (!existing) throw new ApiError(404, "Schedule not found");
    const result = await startWorkflow({
      userId: ctx.user.id,
      workflowId: existing.workflowId,
      deviceId: existing.deviceId,
      dryRun: existing.dryRun,
      trigger: "SCHEDULE",
    });
    return json({ executionId: result.execution.id }, { status: 202 });
  },
};

async function assertOwnedExecution(executionId: string, userId: string) {
  const [row] = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.id, executionId), eq(workflowExecutions.userId, userId)));
  if (!row) throw new ApiError(404, "Execution not found");
  return row;
}

export { emergencyStop };
