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

/** Device tokens are never persisted: only their sha-256 digest is compared. */
export async function verifyDeviceToken(req: Request): Promise<AgentIdentity> {
  const header = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : url.searchParams.get("token")?.trim();
  if (!token) throw new ApiError(401, "Missing device token. Run the agent with DEVICE_TOKEN=<token from pairing>");
  const rows = await db.select().from(devices);
  const device = rows.find((row) => row.tokenHash === hashToken(token));
  if (!device) throw new ApiError(403, "Device token rejected. Re-pair this agent from Devices → Add Device.");
  return { deviceId: device.id, userId: device.userId };
}

export async function deviceName(deviceId: string) {
  const [row] = await db.select({ name: devices.name }).from(devices).where(eq(devices.id, deviceId));
  return row?.name ?? "device";
}

export const agentAuthError = ERROR_MESSAGES.PAIRING_FAILED;
