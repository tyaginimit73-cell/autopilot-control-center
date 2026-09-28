/** Fix #1: finalise() must NOT emergency-stop the link after a normal COMPLETED run. */
import "../setup";
import { attachSimulated } from "@/lib/runtime/index";
import { getLink, startWorkflow, unregisterLink } from "@/lib/runtime/engine";
import { action, cleanupUser, seedDevice, seedUser, seedWorkflow, waitForExecution } from "../fixtures";
import { eq } from "../harness";

export const NAME = "integration/no-estop-on-complete";

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    attachSimulated(device.id, user.id);
    const link = getLink(device.id);
    if (!link) throw new Error("sim link was not registered");
    let emergencyStops = 0;
    const original = link.emergencyStop.bind(link);
    link.emergencyStop = () => {
      emergencyStops += 1;
      original();
    };

    const workflow = await seedWorkflow(user.id, [action("WAIT", { milliseconds: 50 }), action("TYPE_TEXT", { text: "hello" })]);
    const { execution } = await startWorkflow({ userId: user.id, workflowId: workflow.id, deviceId: device.id, dryRun: true });
    const final = await waitForExecution(execution.id);

    eq(final.status, "COMPLETED", "dry-run workflow completes");
    eq(emergencyStops, 0, "normal completion must NOT emergency-stop the link (was: unconditional estop)");
    unregisterLink(device.id);
  } finally {
    await cleanupUser(user.id);
  }
}
