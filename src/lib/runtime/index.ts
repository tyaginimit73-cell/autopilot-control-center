import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { log, publish } from "@/lib/events";
import { ensureDeviceRuntime, runtimes } from "@/lib/runtime/host";
import { registerLink, unregisterLink } from "@/lib/runtime/engine";
import { SimulatedWorkstation } from "@/lib/runtime/sim";
import { markOffline, staleDevices } from "@/lib/runtime/gateway";
import { startScheduler } from "@/lib/runtime/scheduler";
import { AGENT_VERSION, HEARTBEAT_TIMEOUT_MS } from "@autopilot/shared";
import type { Device } from "@autopilot/shared";

/**
 * Runtime bootstrap. Called from `src/instrumentation.ts` at server start and
 * defensively from every API handler, so the platform works whether it is booted
 * by `next start`, `next dev` or a custom server.
 */

const globalForRuntime = globalThis as typeof globalThis & { __autopilotBooted?: boolean };

export function ensureRuntime() {
  if (globalForRuntime.__autopilotBooted) return;
  globalForRuntime.__autopilotBooted = true;
  startScheduler();
  startHealthMonitor();
}

function startHealthMonitor() {
  const timer = setInterval(() => {
    void (async () => {
      // 1. simulated devices are always alive while the server runs
      for (const runtime of runtimes.values()) {
        if (runtime.kind !== "SIMULATED") continue;
        if (!runtime.link) runtime.link = new SimulatedWorkstation(runtime.deviceId, runtime.userId);
        runtime.lastSeen = Date.now();
      }
      // 2. real agents that stopped sending heartbeats are declared offline
      const expired = await staleDevices().catch(() => [] as { id: string; userId: string }[]);
      for (const entry of expired) {
        unregisterLink(entry.id);
        await markOffline(entry.id, entry.userId, "heartbeat expired");
      }
      // 3. keep the DB status column honest for the simulated fleet
      const rows = await db.select({ id: devices.id, status: devices.status, userId: devices.userId }).from(devices).where(eq(devices.kind, "SIMULATED"));
      for (const row of rows) {
        const live = runtimes.get(row.id);
        const shouldBeOnline = Boolean(live?.link) && Date.now() - (live?.lastSeen ?? 0) < HEARTBEAT_TIMEOUT_MS;
        const wanted = shouldBeOnline ? "ONLINE" : "OFFLINE";
        if (row.status !== wanted) {
          await db.update(devices).set({ status: wanted, lastSeen: new Date(), updatedAt: new Date() }).where(eq(devices.id, row.id));
          publish(shouldBeOnline ? "agent:connected" : "agent:disconnected", { deviceId: row.id, reason: shouldBeOnline ? undefined : "runtime idle" }, row.userId);
        }
      }
    })().catch(() => undefined);
  }, 8_000);
  timer.unref?.();
}

export type DeviceRow = typeof devices.$inferSelect;

export function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    kind: row.kind,
    platform: row.platform,
    agentVersion: row.agentVersion,
    status: row.status,
    lastSeen: row.lastSeen ? row.lastSeen.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    capabilities: (row.capabilities as string[] | null) ?? [],
    displayResolution: row.displayResolution,
  };
}

/** Every user gets a local simulated workstation so the platform is usable before
 *  a physical Windows agent is installed. It uses the identical command protocol. */
export async function ensureSimulatedDevice(userId: string): Promise<Device> {
  const existing = await db.select().from(devices).where(and(eq(devices.userId, userId), eq(devices.kind, "SIMULATED")));
  const row = existing[0];
  if (row) {
    attachSimulated(row.id, userId);
    return toDevice(row);
  }
  const [created] = await db
    .insert(devices)
    .values({
      userId,
      name: "Simulated Workstation",
      kind: "SIMULATED",
      platform: "win32 (simulated)",
      agentVersion: `${AGENT_VERSION}-sim`,
      status: "ONLINE",
      capabilities: ["mouse", "keyboard", "windows", "browser", "recorder", "dry-run"],
      displayResolution: "1920x1080",
      lastSeen: new Date(),
    })
    .returning();
  attachSimulated(created.id, userId);
  await log({ userId, deviceId: created.id, level: "INFO", message: "Simulated workstation ready — pair a Windows agent for real OS control" });
  return toDevice(created);
}

export function attachSimulated(deviceId: string, userId: string) {
  const runtime = ensureDeviceRuntime(deviceId, userId, "SIMULATED");
  runtime.userId = userId;
  if (!runtime.link) {
    runtime.link = new SimulatedWorkstation(deviceId, userId);
    registerLink(deviceId, runtime.link);
  }
  return runtime;
}

export async function pairWindowsAgent(deviceId: string, userId: string) {
  await db.update(devices).set({ status: "ONLINE", lastSeen: new Date(), updatedAt: new Date() }).where(eq(devices.id, deviceId));
  ensureDeviceRuntime(deviceId, userId, "WINDOWS_AGENT");
  publish("agent:connected", { deviceId, deviceName: "Windows PC" }, userId);
}
