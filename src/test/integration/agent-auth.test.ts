/** Phase 2 §6: Bearer-only device auth, rotation invalidates, failures fail closed. */
import "../setup";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { deviceHandlers } from "@/lib/api/devices";
import { verifyDeviceToken } from "@/lib/api/agent-auth";
import type { Ctx } from "@/lib/api/router";
import { hashToken } from "@/lib/auth";
import { cleanupUser, seedDevice, seedUser } from "../fixtures";
import { eq as assertEq, expectApiError } from "../harness";

export const NAME = "integration/agent-auth";

const TOKEN_A = "apd_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_BOGUS = "apd_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function authedCtx(userId: string, deviceId: string): Ctx {
  return { user: { id: userId }, params: { id: deviceId }, body: async () => ({}) } as unknown as Ctx;
}

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "OFFLINE", lastSeen: null });
    await db.update(devices).set({ tokenHash: hashToken(TOKEN_A) }).where(eq(devices.id, device.id));

    // 1. Valid Bearer token authenticates with ownership from the row.
    const identity = await verifyDeviceToken(
      new Request("http://test/api/agent/events", { headers: { authorization: `Bearer ${TOKEN_A}` } }),
    );
    assertEq(identity.deviceId, device.id, "identity carries the device id");
    assertEq(identity.userId, user.id, "ownership derives from the matched row");

    // 2. Query-string tokens are rejected even when valid.
    await expectApiError(
      () => verifyDeviceToken(new Request(`http://test/api/agent/events?token=${encodeURIComponent(TOKEN_A)}`)),
      401,
      "query-string token rejected (Bearer-only)",
    );

    // 3. Missing / malformed / unknown tokens fail closed.
    await expectApiError(() => verifyDeviceToken(new Request("http://test/api/agent/events")), 401, "missing token → 401");
    await expectApiError(
      () => verifyDeviceToken(new Request("http://test/api/agent/events", { headers: { authorization: "Bearer not-a-token" } })),
      403,
      "malformed token → 403",
    );
    await expectApiError(
      () => verifyDeviceToken(new Request("http://test/api/agent/events", { headers: { authorization: `Bearer ${TOKEN_BOGUS}` } })),
      403,
      "unknown token → 403",
    );
    await expectApiError(
      () => verifyDeviceToken(new Request("http://test/api/agent/events", { headers: { authorization: `Basic ${TOKEN_A}` } })),
      401,
      "non-Bearer scheme → 401",
    );

    // 4. Rotation: the new token works, the old token is rejected.
    const rotateRes = await deviceHandlers.rotate(authedCtx(user.id, device.id));
    assertEq(rotateRes.status, 200, "rotate succeeds");
    const rotated = (await rotateRes.json()) as { deviceToken: string };
    const rotatedIdentity = await verifyDeviceToken(
      new Request("http://test/api/agent/heartbeat", { headers: { authorization: `Bearer ${rotated.deviceToken}` } }),
    );
    assertEq(rotatedIdentity.deviceId, device.id, "rotated token authenticates");
    await expectApiError(
      () => verifyDeviceToken(new Request("http://test/api/agent/heartbeat", { headers: { authorization: `Bearer ${TOKEN_A}` } })),
      403,
      "pre-rotation token rejected",
    );

    // 5. Unpaired devices (null hash) cannot authenticate.
    const unpaired = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "PAIRING", lastSeen: null });
    const [unpairedRow] = await db.select().from(devices).where(eq(devices.id, unpaired.id));
    assertEq(unpairedRow.tokenHash, null, "unpaired device has no token hash");
    await expectApiError(
      () =>
        verifyDeviceToken(
          new Request("http://test/api/agent/heartbeat", { headers: { authorization: `Bearer ${TOKEN_BOGUS}` } }),
        ),
      403,
      "no token matches an unpaired device",
    );
  } finally {
    await cleanupUser(user.id);
  }
}
