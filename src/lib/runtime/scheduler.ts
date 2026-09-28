import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { log } from "@/lib/events";
import { isDeviceOnline, startWorkflow } from "@/lib/runtime/engine";
import { ERROR_MESSAGES } from "@autopilot/shared";

/**
 * Scheduler. Fires due workflows on their bound device only — a device that is
 * offline is never substituted with another one; the run is skipped (or queued)
 * according to the schedule's misfire policy.
 */

const TICK_MS = 20_000;

type ScheduleRow = typeof schedules.$inferSelect;

export function computeNextRun(schedule: ScheduleRow, from = new Date()): Date | null {
  const [hh, mm] = (schedule.timeOfDay ?? "09:00").split(":").map((v) => Number.parseInt(v, 10) || 0);
  switch (schedule.frequency) {
    case "ONCE":
      return schedule.runAt && schedule.runAt > from ? new Date(schedule.runAt) : null;
    case "INTERVAL": {
      const step = Math.max(1, schedule.intervalMinutes ?? 60) * 60_000;
      return new Date(Math.max(from.getTime() + 1_000, (schedule.lastRunAt?.getTime() ?? from.getTime()) + step));
    }
    case "DAILY": {
      const next = new Date(from);
      next.setHours(hh, mm, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next;
    }
    case "WEEKLY": {
      const target = schedule.dayOfWeek ?? 1;
      const next = new Date(from);
      next.setHours(hh, mm, 0, 0);
      const delta = (target - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + (delta === 0 && next <= from ? 7 : delta));
      return next;
    }
    case "CRON":
      return nextFromCron(schedule.cron ?? "", from);
    default:
      return null;
  }
}

/** Minimal 5-field cron (minute hour day-of-month month day-of-week) supporting
 *  wildcard, lists, ranges and step values. */
export function nextFromCron(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const matches = (field: string, value: number) => {
    if (field === "*") return true;
    return field.split(",").some((chunk) => {
      if (chunk.startsWith("*/")) {
        const step = Number.parseInt(chunk.slice(2), 10);
        return step > 0 && value % step === 0;
      }
      if (chunk.includes("-")) {
        const [a, b] = chunk.split("-").map((n) => Number.parseInt(n, 10));
        return value >= a && value <= b;
      }
      return Number.parseInt(chunk, 10) === value;
    });
  };
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 8; i += 1) {
    if (
      matches(parts[0], cursor.getMinutes()) &&
      matches(parts[1], cursor.getHours()) &&
      matches(parts[2], cursor.getDate()) &&
      matches(parts[3], cursor.getMonth() + 1) &&
      matches(parts[4], cursor.getDay())
    ) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

export async function runSchedulerTick(now = new Date()) {
  const due = await db.select().from(schedules).where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)));
  let fired = 0;
  for (const schedule of due) {
    const online = isDeviceOnline(schedule.deviceId);
    if (!online) {
      if (schedule.misfirePolicy === "QUEUE") {
        await log({
          userId: schedule.userId,
          deviceId: schedule.deviceId,
          workflowId: schedule.workflowId,
          level: "WARN",
          message: `Schedule "${schedule.name}" is queued — device offline (retrying next tick)`,
        });
        fired += 0;
        continue;
      }
      await log({
        userId: schedule.userId,
        deviceId: schedule.deviceId,
        workflowId: schedule.workflowId,
        level: "WARN",
        message: `Schedule "${schedule.name}" skipped — ${ERROR_MESSAGES.AGENT_OFFLINE}`,
      });
      const next = computeNextRun(schedule, now);
      await db.update(schedules).set({ nextRunAt: next, updatedAt: now }).where(eq(schedules.id, schedule.id));
      continue;
    }
    try {
      await startWorkflow({
        userId: schedule.userId,
        workflowId: schedule.workflowId,
        deviceId: schedule.deviceId,
        dryRun: schedule.dryRun,
        trigger: "SCHEDULE",
      });
      await log({ userId: schedule.userId, deviceId: schedule.deviceId, workflowId: schedule.workflowId, level: "SUCCESS", message: `Schedule "${schedule.name}" triggered a workflow run` });
    } catch (error) {
      await log({
        userId: schedule.userId,
        deviceId: schedule.deviceId,
        workflowId: schedule.workflowId,
        level: "ERROR",
        message: `Schedule "${schedule.name}" failed to start — ${(error as Error).message}`,
      });
    }
    const next = computeNextRun({ ...schedule, lastRunAt: now }, now);
    await db.update(schedules).set({ lastRunAt: now, nextRunAt: next, runAt: null, enabled: schedule.frequency === "ONCE" ? false : schedule.enabled, updatedAt: now }).where(eq(schedules.id, schedule.id));
    fired += 1;
  }
  return fired;
}

const globalForScheduler = globalThis as typeof globalThis & { __autopilotScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (globalForScheduler.__autopilotScheduler) return;
  const timer = setInterval(() => {
    runSchedulerTick().catch((error) => console.error("[autopilot] scheduler tick failed", (error as Error)?.message));
  }, TICK_MS);
  timer.unref?.();
  globalForScheduler.__autopilotScheduler = timer;
  // prime nextRunAt values for schedules that have none
  void (async () => {
    const rows = await db.select().from(schedules).where(and(eq(schedules.enabled, true)));
    for (const row of rows) {
      if (!row.nextRunAt) {
        await db.update(schedules).set({ nextRunAt: computeNextRun(row), updatedAt: new Date() }).where(eq(schedules.id, row.id));
      }
    }
  })().catch(() => undefined);
}

export function stopScheduler() {
  if (globalForScheduler.__autopilotScheduler) clearInterval(globalForScheduler.__autopilotScheduler);
  globalForScheduler.__autopilotScheduler = undefined;
}
