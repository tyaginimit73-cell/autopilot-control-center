/** Fix #4 (integration half): the timeout on the wire honours explicit > default. */
import "../setup";
import type { AgentCommand } from "@autopilot/shared";
import { attachSimulated } from "@/lib/runtime/index";
import { dispatchCommand, getLink, unregisterLink } from "@/lib/runtime/engine";
import { cleanupUser, seedDevice, seedUser } from "../fixtures";
import { eq } from "../harness";

export const NAME = "integration/timeout-propagated";

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    attachSimulated(device.id, user.id);
    const link = getLink(device.id);
    if (!link) throw new Error("sim link was not registered");
    const seen: AgentCommand[] = [];
    const originalSend = link.send.bind(link);
    link.send = async (command) => {
      seen.push(command);
      return originalSend(command);
    };
    const last = () => seen[seen.length - 1].timeoutMs;

    await dispatchCommand({ userId: user.id, deviceId: device.id, type: "TYPE_TEXT", parameters: { text: "x" }, dryRun: true, timeoutMs: 5_000 });
    eq(last(), 5_000, "explicit timeoutMs reaches the command (was: dropped by ??/ternary)");

    await dispatchCommand({ userId: user.id, deviceId: device.id, type: "TYPE_TEXT", parameters: { text: "y" }, dryRun: true });
    eq(last(), 15_000, "normal actions default to 15 s on the wire");

    // Control actions are interpreted by the engine, but dispatched directly they
    // still carry the 30 s default (the sim nacks them — we only assert the wire value).
    await dispatchCommand({ userId: user.id, deviceId: device.id, type: "CONDITION", parameters: { conditionKind: "always" }, dryRun: true });
    eq(last(), 30_000, "control actions default to 30 s on the wire");
    unregisterLink(device.id);
  } finally {
    await cleanupUser(user.id);
  }
}
