import { cookies } from "next/headers";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { userSettings, users } from "@/db/schema";
import { authCookie, clearAuthCookie, hashPassword, signAccessToken, verifyPassword } from "@/lib/auth";
import { ApiError, json } from "@/lib/http";
import { log } from "@/lib/events";
import { seedWorkspace } from "@/lib/seed";
import { ensureSimulatedDevice } from "@/lib/runtime/index";
import { loginSchema, registerSchema } from "@autopilot/shared";
import type { Ctx } from "@/lib/api/router";

export const authHandlers = {
  async register(ctx: Ctx) {
    const input = await ctx.body(registerSchema);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email.toLowerCase()));
    if (existing.length) throw new ApiError(409, "That email already has an account. Try signing in instead.");
    const passwordHash = await hashPassword(input.password);
    const [user] = await db
      .insert(users)
      .values({ name: input.name.trim(), email: input.email.toLowerCase(), passwordHash, role: "USER" })
      .returning();
    await db.insert(userSettings).values({ userId: user.id }).onConflictDoNothing();
    await ensureSimulatedDevice(user.id);
    const created = await seedWorkspace(user.id);
    const token = await signAccessToken({ id: user.id, email: user.email, role: user.role });
    const jar = await cookies();
    jar.set(authCookie(token));
    await log({ userId: user.id, level: "SUCCESS", message: `Account created for ${user.email} — ${created.workflows} starter workflows seeded` });
    return json({ user: publicUser(user), token, seeded: created }, { status: 201 });
  },

  async login(ctx: Ctx) {
    const input = await ctx.body(loginSchema);
    const [user] = await db.select().from(users).where(or(eq(users.email, input.email.toLowerCase()), eq(users.email, input.email)));
    if (!user) throw new ApiError(401, "Email or password is incorrect");
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      await log({ userId: user.id, level: "WARN", message: "Failed sign-in attempt" });
      throw new ApiError(401, "Email or password is incorrect");
    }
    const token = await signAccessToken({ id: user.id, email: user.email, role: user.role });
    const jar = await cookies();
    jar.set(authCookie(token));
    await ensureSimulatedDevice(user.id);
    await log({ userId: user.id, level: "INFO", message: "Signed in" });
    return json({ user: publicUser(user), token });
  },

  async logout() {
    const jar = await cookies();
    jar.set(clearAuthCookie());
    return json({ ok: true });
  },

  async me(ctx: Ctx) {
    if (!ctx.user?.id) return json({ user: null });
    const [row] = await db.select().from(users).where(eq(users.id, ctx.user.id));
    if (!row) return json({ user: null });
    return json({ user: publicUser(row) });
  },
};

export function publicUser(row: typeof users.$inferSelect) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.createdAt.toISOString() };
}


