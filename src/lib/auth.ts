import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { User } from "@autopilot/shared";

const encoder = new TextEncoder();

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    // Development fallback. In production the server refuses to boot without JWT_SECRET.
    return encoder.encode("autopilot-dev-insecure-secret-change-me");
  }
  return encoder.encode(secret);
}

export const ACCESS_TOKEN_TTL = "7d";
export const AUTH_COOKIE = "autopilot_session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 11);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: "USER" | "ADMIN";
  /** short-lived stateless CSRF-ish binding for socket/agent upgrades */
  v: "1";
}

export async function signAccessToken(user: Pick<User, "id" | "email" | "role">): Promise<string> {
  const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role, v: "1" };
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("autopilot-control-center")
    .setAudience("autopilot-dashboard")
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "autopilot-control-center",
      audience: "autopilot-dashboard",
    });
    if (payload.v !== "1" || typeof payload.sub !== "string") return null;
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

export function authCookie(token: string, secure = process.env.NODE_ENV === "production") {
  return {
    name: AUTH_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function clearAuthCookie() {
  return { name: AUTH_COOKIE, value: "", httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
}

/** Device tokens: `apd_<deviceId>_<random>` — only the hash is stored server side. */
export function generateDeviceToken(deviceId: string): { token: string; tokenHash: string } {
  const random = cryptoRandom(28);
  const token = `apd_${deviceId.slice(0, 8)}_${random}`;
  return { token, tokenHash: hashToken(token) };
}

export function cryptoRandom(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hashToken(token: string): string {
  // Synchronous SHA-256 via node:crypto keeps agent auth cheap.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("node:crypto") as typeof import("node:crypto");
  return nodeCrypto.createHash("sha256").update(token).digest("hex");
}

export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => alphabet[b % alphabet.length])
      .join("");
  return `PAIR-${block(4)}-${block(4)}`;
}
