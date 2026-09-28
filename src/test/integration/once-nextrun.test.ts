/** Fix #6 (integration half): ONCE schedule creation validates runAt and sets nextRunAt. */
import "../setup";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { workflowHandlers } from "@/lib/api/workflows";
import type { Ctx } from "@/lib/api/router";
import { action, cleanupUser, seedDevice, seedUser, seedWorkflow } from "../fixtures";
import { eq as assertEq, expectApiError } from "../harness";

export const NAME = "integration/once-nextrun";

function ctxFor(userId: string, payload: unknown): Ctx {
  return {
    user: { id: userId },
    params: {},
    body: async (schema: { parse: (value: unknown) => never }) => schema.parse(payload),
  } as unknown as Ctx;
}

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    const workflow = await seedWorkflow(user.id, [action("WAIT", { milliseconds: 10 })]);
    const base = { workflowId: workflow.id, deviceId: device.id, name: "once-test", frequency: "ONCE", timeOfDay: "09:00", dryRun: true };

    const runAt = new Date(Date.now() + 3_600_000);
    await workflowHandlers.createSchedule(ctxFor(user.id, { ...base, runAt: runAt.toISOString() }));
    const [created] = await db.select().from(schedules).where(eq(schedules.workflowId, workflow.id));
    if (!created?.nextRunAt) throw new Error("CHECK FAILED: ONCE schedule must have nextRunAt set at creation");
    assertEq(created.nextRunAt.getTime(), runAt.getTime(), "ONCE nextRunAt equals runAt exactly");
    assertEq(created.runAt?.getTime(), runAt.getTime(), "ONCE runAt is persisted");

    await expectApiError(
      () => workflowHandlers.createSchedule(ctxFor(user.id, { ...base, runAt: new Date(Date.now() - 60_000).toISOString() })),
      422,
      "ONCE with a past runAt is rejected",
    );
    await expectApiError(() => workflowHandlers.createSchedule(ctxFor(user.id, base)), 422, "ONCE without runAt is rejected");
  } finally {
    await cleanupUser(user.id);
  }
}
