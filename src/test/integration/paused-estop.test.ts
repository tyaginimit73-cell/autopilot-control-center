/** Fix #5: PAUSED is a real persisted state, and emergency stop cancels paused runs. */
import "../setup";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflowExecutions } from "@/db/schema";
import { attachSimulated } from "@/lib/runtime/index";
import { createControl, releaseControl } from "@/lib/runtime/host";
import { emergencyStop, pauseExecution, resumeExecution, unregisterLink } from "@/lib/runtime/engine";
import { cleanupUser, seedDevice, seedUser, waitForExecution, waitForStatus } from "../fixtures";
import { eq as assertEq } from "../harness";

export const NAME = "integration/paused-estop";

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    attachSimulated(device.id, user.id);

    // Scenario 1: a control-less PAUSED row is stopped and persisted STOPPED.
    const [paused] = await db
      .insert(workflowExecutions)
      .values({ workflowName: "paused-test", userId: user.id, deviceId: device.id, status: "PAUSED", totalActions: 2 })
      .returning();
    const first = await emergencyStop(user.id, device.id);
    assertEq(first.stopped, 1, "paused execution counts as active (was: invisible, stopped=0)");
    const finalPaused = await waitForExecution(paused.id);
    assertEq(finalPaused.status, "STOPPED", "paused execution becomes STOPPED");

    // Scenario 2: the live path — pause persists PAUSED, resume restores RUNNING,
    // and a re-paused run is still estopped.
    const [live] = await db
      .insert(workflowExecutions)
      .values({ workflowName: "live-pause-test", userId: user.id, deviceId: device.id, status: "RUNNING", totalActions: 2 })
      .returning();
    createControl({ executionId: live.id, deviceId: device.id, userId: user.id, currentActionIndex: 0, stepsSnapshot: [], skip: 0 });
    try {
      pauseExecution(live.id);
      assertEq((await waitForStatus(live.id, "PAUSED")).status, "PAUSED", "pauseExecution persists PAUSED");
      resumeExecution(live.id);
      assertEq((await waitForStatus(live.id, "RUNNING")).status, "RUNNING", "resumeExecution persists RUNNING");
      pauseExecution(live.id);
      assertEq((await waitForStatus(live.id, "PAUSED")).status, "PAUSED", "second pause persists PAUSED");
    } finally {
      releaseControl(live.id);
    }
    const second = await emergencyStop(user.id, device.id);
    assertEq(second.stopped, 1, "re-paused execution is estopped");
    const finalLive = await waitForExecution(live.id);
    assertEq(finalLive.status, "STOPPED", "re-paused execution becomes STOPPED");

    // Sanity: no stray rows left behind in a live state.
    const leftovers = await db
      .select({ id: workflowExecutions.id })
      .from(workflowExecutions)
      .where(eq(workflowExecutions.deviceId, device.id));
    assertEq(leftovers.length, 2, "only the two scenario rows exist");
    unregisterLink(device.id);
  } finally {
    await cleanupUser(user.id);
  }
}
