/** End-to-end control-plane run: 5-action dry-run workflow completes 5/5 on a sim link. */
import "../setup";
import { attachSimulated } from "@/lib/runtime/index";
import { startWorkflow, unregisterLink } from "@/lib/runtime/engine";
import { action, cleanupUser, seedDevice, seedUser, seedWorkflow, waitForExecution } from "../fixtures";
import { check, eq } from "../harness";

export const NAME = "integration/dryrun-workflow";

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    attachSimulated(device.id, user.id);

    const workflow = await seedWorkflow(user.id, [
      action("WAIT", { milliseconds: 20 }),
      action("MOVE_MOUSE", { x: 400, y: 300 }),
      action("TYPE_TEXT", { text: "dry-run-ok" }),
      action("HOTKEY", { key: "S", modifiers: ["CTRL"] }),
      action("CONDITION", { conditionKind: "always" }),
    ]);
    const { execution } = await startWorkflow({ userId: user.id, workflowId: workflow.id, deviceId: device.id, dryRun: true });
    const final = await waitForExecution(execution.id);

    eq(final.status, "COMPLETED", "dry-run workflow completes");
    eq(final.error, null, "no error recorded");
    eq(final.steps.length, 5, "five steps recorded");
    check(final.steps.every((step) => step.status === "COMPLETED"), "all 5 steps COMPLETED");
    unregisterLink(device.id);
  } finally {
    await cleanupUser(user.id);
  }
}
