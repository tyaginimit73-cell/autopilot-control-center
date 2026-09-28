/** Fix #9: the workflow delete guard queries executions by workflow id (not device id). */
import "../setup";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflowExecutions } from "@/db/schema";
import { deviceHasActiveExecution, workflowHasActiveExecution } from "@/lib/runtime/engine";
import { action, cleanupUser, seedDevice, seedUser, seedWorkflow } from "../fixtures";
import { eq as assertEq } from "../harness";

export const NAME = "integration/delete-guard";

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    const workflow = await seedWorkflow(user.id, [action("WAIT", { milliseconds: 10 })]);
    const [exec] = await db
      .insert(workflowExecutions)
      .values({ workflowId: workflow.id, workflowName: workflow.name, userId: user.id, deviceId: device.id, status: "RUNNING", totalActions: 1 })
      .returning();

    // The old guard called deviceHasActiveExecution(workflowId): a workflow id is
    // never a busy device id, so it always returned false and the guard never fired.
    assertEq(deviceHasActiveExecution(workflow.id), false, "documents the old always-false shape");
    assertEq(await workflowHasActiveExecution(workflow.id), true, "RUNNING execution blocks workflow delete");

    await db.update(workflowExecutions).set({ status: "PAUSED" }).where(eq(workflowExecutions.id, exec.id));
    assertEq(await workflowHasActiveExecution(workflow.id), true, "PAUSED execution blocks workflow delete");

    await db.update(workflowExecutions).set({ status: "COMPLETED" }).where(eq(workflowExecutions.id, exec.id));
    assertEq(await workflowHasActiveExecution(workflow.id), false, "COMPLETED execution allows workflow delete");
  } finally {
    await cleanupUser(user.id);
  }
}
