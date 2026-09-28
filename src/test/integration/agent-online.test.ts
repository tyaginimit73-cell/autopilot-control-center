/** Agent lifecycle: stream open → ONLINE + fresh lastSeen; close → OFFLINE. */
import "../setup";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { isDeviceOnline } from "@/lib/runtime/engine";
import { openAgentStream, staleDevices } from "@/lib/runtime/gateway";
import { cleanupUser, seedDevice, seedUser } from "../fixtures";
import { check, eq as assertEq } from "../harness";

export const NAME = "integration/agent-online";

async function readDevice(id: string) {
  const [row] = await db.select().from(devices).where(eq(devices.id, id));
  if (!row) throw new Error("device row went missing");
  return row;
}

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "PAIRING", lastSeen: null });

    const writes: { event: string; payload: unknown }[] = [];
    const close = await openAgentStream(device.id, user.id, (event, payload) => {
      writes.push({ event, payload });
    });

    const online = await readDevice(device.id);
    assertEq(online.status, "ONLINE", "connected agent is ONLINE");
    check(online.lastSeen instanceof Date && Date.now() - online.lastSeen.getTime() < 10_000, "lastSeen is fresh after connect");
    assertEq(isDeviceOnline(device.id), true, "engine link is registered");
    const stale = await staleDevices();
    check(!stale.some((entry) => entry.id === device.id), "freshly connected agent is not stale");

    close();
    const deadline = Date.now() + 5_000;
    for (;;) {
      const row = await readDevice(device.id);
      if (row.status === "OFFLINE") break;
      if (Date.now() > deadline) throw new Error(`CHECK FAILED: agent did not go OFFLINE (still ${row.status})`);
      await new Promise((r) => setTimeout(r, 50));
    }
    assertEq(isDeviceOnline(device.id), false, "engine link is unregistered after close");
    await new Promise((r) => setTimeout(r, 400));
  } finally {
    await cleanupUser(user.id);
  }
}
