import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AUTH_COOKIE, verifyAccessToken } from "@/lib/auth";
import { RATE_LIMITS, ERROR_MESSAGES } from "@autopilot/shared";
import type { User } from "@autopilot/shared";

/** API errors are always mapped to a friendly message — stack traces never travel. */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface Session extends User {}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...init.headers,
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.message, code: error.code ?? httpStatusText(error.status), details: error.details }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return json(
      { error: first?.message ?? "Invalid request", code: "VALIDATION", details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 422 },
    );
  }
  console.error("[autopilot] unhandled api error", error);
  return json({ error: "The control plane hit an unexpected error. Please retry.", code: "INTERNAL" }, { status: 500 });
}

function httpStatusText(status: number) {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORISED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 504) return "TIMEOUT";
  return "INTERNAL";
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(422, issue?.message ?? "Invalid request", "VALIDATION", parsed.error.issues.slice(0, 6).map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return parsed.data;
}

export async function readQuery(req: Request, schema: z.ZodType<unknown>) {
  const url = new URL(req.url);
  const parsed = (schema as z.ZodType<object>).safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw new ApiError(422, (parsed.error.issues[0]?.message ?? "Invalid query"), "VALIDATION");
  return parsed.data;
}

export async function currentUser(req?: Request): Promise<Session | null> {
  let token: string | undefined;
  try {
    const jar = await cookies();
    token = jar.get(AUTH_COOKIE)?.value;
  } catch {
    token = undefined;
  }
  if (!token && req) {
    const header = req.headers.get("authorization") ?? "";
    token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  }
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  if (!payload) return null;
  const [row] = await db.select().from(users).where(eq(users.id, payload.sub));
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.createdAt.toISOString() };
}

export async function requireUser(req?: Request): Promise<Session> {
  const user = await currentUser(req);
  if (!user) throw new ApiError(401, ERROR_MESSAGES.UNAUTHORISED);
  return user;
}

/** In-memory token bucket: good enough for a single-node local-first control plane. */
const buckets = globalThis.__autopilotBuckets ?? new Map<string, { count: number; resetAt: number }>();
globalThis.__autopilotBuckets = buckets;

export function consumeRateLimit(key: string, limit: { max: number; windowMs: number }) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { remaining: limit.max - 1, resetAt: now + limit.windowMs };
  }
  bucket.count += 1;
  if (bucket.count > limit.max) throw new ApiError(429, ERROR_MESSAGES.RATE_LIMITED, undefined, { retryAfterMs: bucket.resetAt - now });
  return { remaining: limit.max - bucket.count, resetAt: bucket.resetAt };
}

export function rateLimitFromRequest(req: NextRequest | Request, bucket: keyof typeof RATE_LIMITS, userId?: string) {
  const url = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || url.host;
  return consumeRateLimit(`${bucket}:${userId ?? ip}`, RATE_LIMITS[bucket]);
}

declare global {
  // eslint-disable-next-line no-var
  var __autopilotBuckets: Map<string, { count: number; resetAt: number }> | undefined;
}
