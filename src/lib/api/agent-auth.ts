import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { hashToken } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { ERROR_MESSAGES } from "@autopilot/shared";

export interface AgentIdentity {
  deviceId: string;
  userId: string;
}

/** Constant-time hex comparison (lengths are equal for sha-256 digests). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("node:crypto") as typeof import("node:crypto");
  return nodeCrypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Device tokens are never persisted: only their sha-256 digest is compared.
 * Bearer-only: query-string tokens are NOT accepted (they leak into proxy and
 * server access logs). Identity — including ownership — derives from the
 * matched device row, so rotated, unpaired (null hash) and unknown tokens all
 * fail closed.
 */
export async function verifyDeviceToken(req: Request): Promise<AgentIdentity> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "Missing device token. Run the agent with DEVICE_TOKEN=<token from pairing>");
  const candidate = hashToken(token);
  const rows = await db.select().from(devices);
  const device = rows.find((row) => row.tokenHash !== null && safeEqualHex(row.tokenHash, candidate));
  if (!device) throw new ApiError(403, "Device token rejected. Re-pair this agent from Devices → Add Device.");
  return { deviceId: device.id, userId: device.userId };
}

export async function deviceName(deviceId: string) {
  const [row] = await db.select({ name: devices.name }).from(devices).where(eq(devices.id, deviceId));
  return row?.name ?? "device";
}

export const agentAuthError = ERROR_MESSAGES.PAIRING_FAILED;
