/** Fix #8: NULL-lastSeen ONLINE agents are stale; sims are never swept by heartbeats. */
import "../setup";
import { staleDevices } from "@/lib/runtime/gateway";
import { cleanupUser, seedDevice, seedUser } from "../fixtures";
import { check } from "../harness";

export const NAME = "integration/null-lastseen-stale";

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const nullAgent = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "ONLINE", lastSeen: null });
    const nullSim = await seedDevice(user.id, { kind: "SIMULATED", status: "ONLINE", lastSeen: null });
    const freshAgent = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "ONLINE", lastSeen: new Date() });
    const oldAgent = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "ONLINE", lastSeen: new Date("2020-01-01T00:00:00.000Z") });
    const offlineNull = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "OFFLINE", lastSeen: null });

    const stale = await staleDevices();
    const ids = new Set(stale.map((entry) => entry.id));

    check(ids.has(nullAgent.id), "ONLINE agent with NULL lastSeen is stale (was: excluded by SQL)");
    check(ids.has(oldAgent.id), "ONLINE agent with an ancient lastSeen is stale");
    check(!ids.has(nullSim.id), "SIMULATED devices are never heartbeat-swept");
    check(!ids.has(freshAgent.id), "fresh ONLINE agent is not stale");
    check(!ids.has(offlineNull.id), "OFFLINE devices are not re-swept");
  } finally {
    await cleanupUser(user.id);
  }
}
