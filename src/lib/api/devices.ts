import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLogs, applicationProfiles, devices, workflows } from "@/db/schema";
import { generateDeviceToken, newPairingCode } from "@/lib/auth";
import { ApiError, json } from "@/lib/http";
import { log } from "@/lib/events";
import { ensureSimulatedDevice, toDevice } from "@/lib/runtime/index";
import { isDeviceOnline } from "@/lib/runtime/engine";
import { runtimes } from "@/lib/runtime/host";
import { agentPairSchema, applicationProfileSchema, deviceCreateSchema, PAIRING_CODE_TTL_MS } from "@autopilot/shared";
import type { Ctx } from "@/lib/api/router";

export const deviceHandlers = {
  async list(ctx: Ctx) {
    await ensureSimulatedDevice(ctx.user.id);
    const rows = await db.select().from(devices).where(eq(devices.userId, ctx.user.id)).orderBy(desc(devices.createdAt));
    return json({
      devices: rows.map((row) => ({
        ...toDevice(row),
        connected: isDeviceOnline(row.id),
        hasPairingCode: Boolean(row.pairingCode && row.pairingExpiresAt && row.pairingExpiresAt > new Date()),
        pairingCode: row.pairingCode ?? null,
        pairingExpiresAt: row.pairingExpiresAt ? row.pairingExpiresAt.toISOString() : null,
      })),
    });
  },

  /** "Add Device" → a single-use pairing code. No secret material is returned. */
  async createPairing(ctx: Ctx) {
    const input = await ctx.body(deviceCreateSchema);
    const code = newPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    const [row] = await db
      .insert(devices)
      .values({
        userId: ctx.user.id,
        name: input.name,
        platform: input.platform,
        kind: "WINDOWS_AGENT",
        status: "PAIRING",
        pairingCode: code,
        pairingExpiresAt: expiresAt,
        agentVersion: "awaiting agent",
      })
      .returning();
    await log({ userId: ctx.user.id, deviceId: row.id, level: "INFO", message: `Pairing code ${code} generated for ${input.name} (valid 10 minutes)` });
    return json({ deviceId: row.id, code, expiresAt: expiresAt.toISOString() }, { status: 201 });
  },

  /** Create the device row without a code (used by the CLI `--name` flow). */
  async createManual(ctx: Ctx) {
    const input = await ctx.body(deviceCreateSchema.extend({ pairingCode: z.string().optional() }));
    const code = input.pairingCode ?? newPairingCode();
    const [row] = await db
      .insert(devices)
      .values({
        userId: ctx.user.id,
        name: input.name,
        platform: input.platform,
        kind: "WINDOWS_AGENT",
        status: "PAIRING",
        pairingCode: code,
        pairingExpiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
      })
      .returning();
    return json({ deviceId: row.id, code, expiresAt: row.pairingExpiresAt?.toISOString() }, { status: 201 });
  },

  async update(ctx: Ctx) {
    const input = await ctx.body(z.object({ name: z.string().min(2).max(80).optional(), platform: z.string().max(60).optional() }));
    const [row] = await db.select().from(devices).where(eq(devices.id, ctx.params.id));
    if (!row || row.userId !== ctx.user.id) throw new ApiError(404, "Device not found");
    const [updated] = await db
      .update(devices)
      .set({ name: input.name ?? row.name, platform: input.platform ?? row.platform, updatedAt: new Date() })
      .where(eq(devices.id, row.id))
      .returning();
    return json({ device: toDevice(updated) });
  },

  async remove(ctx: Ctx) {
    const [row] = await db.select().from(devices).where(eq(devices.id, ctx.params.id));
    if (!row || row.userId !== ctx.user.id) throw new ApiError(404, "Device not found");
    if (row.kind === "SIMULATED") throw new ApiError(409, "The simulated workstation is built in and cannot be removed. Disconnect a real agent instead.");
    await db.delete(devices).where(eq(devices.id, row.id));
    runtimes.delete(row.id);
    await log({ userId: ctx.user.id, level: "WARN", message: `Device ${row.name} unpaired` });
    return json({ ok: true });
  },

  /** Rotate the device credential. The new token is shown exactly once. */
  async rotate(ctx: Ctx) {
    const [row] = await db.select().from(devices).where(eq(devices.id, ctx.params.id));
    if (!row || row.userId !== ctx.user.id) throw new ApiError(404, "Device not found");
    const { token, tokenHash } = generateDeviceToken(row.id);
    await db.update(devices).set({ tokenHash, updatedAt: new Date() }).where(eq(devices.id, row.id));
    await log({ userId: ctx.user.id, deviceId: row.id, level: "WARN", message: "Device token rotated — restart the agent with the new token" });
    return json({ deviceToken: token });
  },

  async state(ctx: Ctx) {
    const runtime = runtimes.get(ctx.params.id);
    if (!runtime) throw new ApiError(404, "No live state for this device yet. Connect the agent and try again.");
    return json({ state: runtime.state, capabilities: runtime.capabilities, lastSeen: new Date(runtime.lastSeen).toISOString() });
  },

  /* ── agent pairing handshake (no user session) ─────────────────────────── */
  async agentPair(ctx: Ctx) {
    const input = await ctx.body(agentPairSchema);
    const code = input.pairingCode.toUpperCase();
    const [row] = await db.select().from(devices).where(eq(devices.pairingCode, code));
    if (!row) {
      throw new ApiError(400, "Pairing failed: the code is invalid, expired, or already used.");
    }
    const { token, tokenHash } = generateDeviceToken(row.id);
    // The consume is atomic: the UPDATE only matches while the code is still
    // present and unexpired, so two concurrent pair attempts cannot both win.
    const [updated] = await db
      .update(devices)
      .set({
        tokenHash,
        pairingCode: null,
        pairingExpiresAt: null,
        name: input.deviceName || row.name,
        platform: input.platform,
        agentVersion: input.agentVersion,
        capabilities: input.capabilities,
        displayResolution: input.displayResolution ?? row.displayResolution,
        status: "OFFLINE",
        updatedAt: new Date(),
      })
      .where(and(eq(devices.id, row.id), eq(devices.pairingCode, code), gt(devices.pairingExpiresAt, new Date())))
      .returning();
    if (!updated) {
      throw new ApiError(400, "Pairing failed: the code is invalid, expired, or already used.");
    }
    await log({ userId: row.userId, deviceId: row.id, level: "SUCCESS", message: `${input.deviceName} paired (agent ${input.agentVersion}, ${input.platform})` });
    return json({ deviceId: updated.id, deviceToken: token, userId: updated.userId }, { status: 201 });
  },

  /* ── application profiles (user-configured; never hardcoded paths) ─────── */
  async applications(ctx: Ctx) {
    const rows = await db.select().from(applicationProfiles).where(eq(applicationProfiles.userId, ctx.user.id)).orderBy(asc(applicationProfiles.name));
    return json({ applications: rows });
  },

  async createApplication(ctx: Ctx) {
    const input = await ctx.body(applicationProfileSchema);
    const [row] = await db.insert(applicationProfiles).values({ ...input, userId: ctx.user.id }).returning();
    await log({ userId: ctx.user.id, level: "INFO", message: `Application profile added — ${row.name} (${row.executablePath})` });
    return json({ application: row }, { status: 201 });
  },

  async updateApplication(ctx: Ctx) {
    const input = await ctx.body(applicationProfileSchema.partial());
    const [existing] = await db.select().from(applicationProfiles).where(eq(applicationProfiles.id, ctx.params.id));
    if (!existing || existing.userId !== ctx.user.id) throw new ApiError(404, "Application profile not found");
    const [row] = await db.update(applicationProfiles).set({ ...input, updatedAt: new Date() }).where(eq(applicationProfiles.id, ctx.params.id)).returning();
    return json({ application: row });
  },

  async removeApplication(ctx: Ctx) {
    const [existing] = await db.select().from(applicationProfiles).where(eq(applicationProfiles.id, ctx.params.id));
    if (!existing || existing.userId !== ctx.user.id) throw new ApiError(404, "Application profile not found");
    await db.delete(applicationProfiles).where(eq(applicationProfiles.id, ctx.params.id));
    return json({ ok: true });
  },
};

export async function countWorkflows(userId: string) {
  const rows = await db.select({ id: workflows.id }).from(workflows).where(eq(workflows.userId, userId));
  return rows.length;
}

export async function countLogs(userId: string) {
  const rows = await db.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.userId, userId)).limit(500);
  return rows.length;
}
