/** Fix #1 (counterpart): a REAL emergency stop still cancels, signals and publishes. */
import "../setup";
import { db } from "@/db";
import { workflowExecutions } from "@/db/schema";
import { subscribe } from "@/lib/events";
import { attachSimulated } from "@/lib/runtime/index";
import { emergencyStop, getLink, unregisterLink } from "@/lib/runtime/engine";
import { cleanupUser, seedDevice, seedUser, waitForExecution } from "../fixtures";
import { eq } from "../harness";

export const NAME = "integration/estop-emits";

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

    const [exec] = await db
      .insert(workflowExecutions)
      .values({ workflowName: "estop-test", userId: user.id, deviceId: device.id, status: "RUNNING", totalActions: 1 })
      .returning();

    const events: unknown[] = [];
    const unsubscribe = subscribe(user.id, (envelope) => {
      if (envelope.event === "system:emergency-stop") events.push(envelope.payload);
    });
    try {
      const result = await emergencyStop(user.id, device.id);
      eq(result.stopped, 1, "emergency stop reports one cancelled execution");
    } finally {
      unsubscribe();
    }

    // stopExecution's DB write for a control-less row is fire-and-forget: poll.
    const final = await waitForExecution(exec.id);
    eq(final.status, "STOPPED", "execution row becomes STOPPED");
    eq(events.length, 1, "system:emergency-stop is published");
    eq((events[0] as { stopped: number }).stopped, 1, "event reports stopped=1");
    eq(emergencyStops, 1, "link receives exactly one emergencyStop");
    unregisterLink(device.id);
  } finally {
    await cleanupUser(user.id);
  }
}
