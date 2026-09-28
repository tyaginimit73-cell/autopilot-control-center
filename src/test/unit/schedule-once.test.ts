/** Fix #6 (unit half): ONCE schedules resolve nextRunAt from runAt at creation time. */
import "../setup";
import { computeNextRun } from "@/lib/runtime/scheduler";
import { check, eq } from "../harness";

export const NAME = "unit/schedule-once";

type ScheduleRow = Parameters<typeof computeNextRun>[0];

function row(runAt: Date | null): ScheduleRow {
  return { frequency: "ONCE", timeOfDay: "09:00", runAt, lastRunAt: null } as unknown as ScheduleRow;
}

export async function run(): Promise<void> {
  const now = new Date("2026-09-28T10:00:00.000Z");
  const future = new Date("2026-09-28T12:30:00.000Z");

  const next = computeNextRun(row(future), now);
  check(next instanceof Date, "ONCE with future runAt yields a date");
  eq((next as Date).getTime(), future.getTime(), "ONCE nextRunAt equals runAt exactly");

  eq(computeNextRun(row(new Date("2026-09-28T09:59:59.000Z")), now), null, "ONCE with past runAt yields null");
  eq(computeNextRun(row(null), now), null, "ONCE without runAt yields null (must be rejected at creation)");
}
