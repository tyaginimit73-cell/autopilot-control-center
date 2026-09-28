import type { NextRequest } from "next/server";
import { handleApi } from "@/lib/api/router";
import { ensureRuntime } from "@/lib/runtime/index";

/**
 * The whole control-plane REST surface is declared in `src/lib/api/router.ts`
 * and mounted here so the compiled Next server serves the exact URLs from the
 * specification (`/api/auth/*`, `/api/devices/*`, `/api/workflows/*`, ...).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  ensureRuntime();
  return handleApi(req, "GET");
}
export async function POST(req: NextRequest) {
  ensureRuntime();
  return handleApi(req, "POST");
}
export async function PUT(req: NextRequest) {
  ensureRuntime();
  return handleApi(req, "PUT");
}
export async function PATCH(req: NextRequest) {
  ensureRuntime();
  return handleApi(req, "PATCH");
}
export async function DELETE(req: NextRequest) {
  ensureRuntime();
  return handleApi(req, "DELETE");
}
