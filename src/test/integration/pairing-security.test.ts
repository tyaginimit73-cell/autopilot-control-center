/** Phase 2 §7: pairing codes are validated, expiring, single-use and secret-free. */
import "../setup";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { deviceHandlers } from "@/lib/api/devices";
import type { Ctx } from "@/lib/api/router";
import { ApiError } from "@/lib/http";
import { cleanupUser, seedDevice, seedUser } from "../fixtures";
import { check, eq as assertEq, excludes, expectApiError, includes } from "../harness";

export const NAME = "integration/pairing-security";

function ctxFor(userId: string, payload: unknown): Ctx {
  return {
    user: { id: userId },
    params: {},
    // Mirror production readJson: schema failures surface as ApiError 422.
    body: (async <T>(schema: z.ZodType<T>): Promise<T> => {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid body");
      return parsed.data;
    }),
  } as unknown as Ctx;
}

function pairPayload(code: string) {
  return {
    pairingCode: code,
    deviceName: "Phase2 Test Agent",
    platform: "win32",
    agentVersion: "1.0.0",
    capabilities: ["dry-run"],
  };
}

/** Unique DB code per row (pairing_code has a unique index). Matches PAIR-XXXX-XXXX. */
function freshCode(): string {
  const hex = randomUUID().replace(/-/g, "").toUpperCase();
  return `PAIR-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    // 1. Successful pairing returns credentials and consumes the code.
    const code = freshCode();
    const device = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "PAIRING", lastSeen: null });
    await db
      .update(devices)
      .set({ pairingCode: code, pairingExpiresAt: new Date(Date.now() + 600_000) })
      .where(eq(devices.id, device.id));

    const res = await deviceHandlers.agentPair(ctxFor(user.id, pairPayload(code)));
    assertEq(res.status, 201, "pairing succeeds");
    const body = (await res.json()) as { deviceId: string; deviceToken: string; userId: string };
    assertEq(body.deviceId, device.id, "paired device id matches");
    assertEq(body.userId, user.id, "ownership matches");
    check(body.deviceToken.startsWith("apd_"), "device token has the apd_ shape");

    const [consumed] = await db.select().from(devices).where(eq(devices.id, device.id));
    assertEq(consumed.pairingCode, null, "code invalidated after successful pairing");
    assertEq(consumed.pairingExpiresAt, null, "code expiry cleared after pairing");
    check(consumed.tokenHash !== null && !consumed.tokenHash.includes(body.deviceToken), "only the hash is stored, never the token");

    // 2. Single-use: replaying the consumed code fails generically.
    await expectApiError(() => deviceHandlers.agentPair(ctxFor(user.id, pairPayload(code))), 400, "consumed code is single-use");

    // 3. Expired codes fail.
    const expiredCode = freshCode();
    const expiredDevice = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "PAIRING", lastSeen: null });
    await db
      .update(devices)
      .set({ pairingCode: expiredCode, pairingExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(devices.id, expiredDevice.id));
    await expectApiError(() => deviceHandlers.agentPair(ctxFor(user.id, pairPayload(expiredCode))), 400, "expired code rejected");

    // 4. Unknown codes fail with the same generic message (no enumeration oracle).
    const messages = new Set<string>();
    for (const probe of [pairPayload(freshCode()), pairPayload(code)]) {
      try {
        await deviceHandlers.agentPair(ctxFor(user.id, probe));
        throw new Error("CHECK FAILED: bogus pairing must not succeed");
      } catch (error) {
        messages.add((error as Error).message);
      }
    }
    assertEq(messages.size, 1, "unknown/used/expired codes share one generic message");
    includes([...messages][0], "invalid, expired, or already used", "generic failure message");

    // 5. Malformed codes are rejected cleanly by the schema (422, no stack).
    await expectApiError(() => deviceHandlers.agentPair(ctxFor(user.id, pairPayload("not-a-code"))), 422, "malformed code rejected");

    // 6. Failure paths leak nothing.
    try {
      await deviceHandlers.agentPair(ctxFor(user.id, pairPayload(freshCode())));
      throw new Error("CHECK FAILED: bogus pairing must not succeed");
    } catch (error) {
      const text = `${(error as Error).message} ${(error as { details?: unknown }).details ?? ""}`;
      excludes(text, "apd_", "failure carries no token material");
    }
  } finally {
    await cleanupUser(user.id);
  }
}
