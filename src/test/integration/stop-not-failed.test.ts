/** Fix #3: an authored STOP ends the run COMPLETED (early exit), never FAILED. */
import "../setup";
import { attachSimulated } from "@/lib/runtime/index";
import { startWorkflow, unregisterLink } from "@/lib/runtime/engine";
import { action, cleanupUser, seedDevice, seedUser, seedWorkflow, waitForExecution } from "../fixtures";
import { eq, includes } from "../harness";

export const NAME = "integration/stop-not-failed";

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    attachSimulated(device.id, user.id);

    const workflow = await seedWorkflow(user.id, [
      action("WAIT", { milliseconds: 10 }),
      action("STOP"),
      action("WAIT", { milliseconds: 10 }),
    ]);
    const { execution } = await startWorkflow({ userId: user.id, workflowId: workflow.id, deviceId: device.id, dryRun: true });
    const final = await waitForExecution(execution.id);

    eq(final.status, "COMPLETED", "STOP run finishes COMPLETED, not FAILED");
    eq(final.error, null, "STOP run records no error");
    eq(final.steps.length, 3, "three steps recorded");
    eq(final.steps[0].status, "COMPLETED", "step before STOP completed");
    eq(final.steps[1].status, "COMPLETED", "STOP step itself completed");
    includes(final.steps[1].message, "stopped early", "STOP step explains the early exit");
    eq(final.steps[2].status, "PENDING", "steps after STOP stay PENDING (never ran)");
    unregisterLink(device.id);
  } finally {
    await cleanupUser(user.id);
  }
}
