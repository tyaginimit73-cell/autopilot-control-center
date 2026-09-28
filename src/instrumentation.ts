/**
 * Next.js instrumentation hook — runs once when the Node server boots.
 * Starts the automation runtime (device host, health monitor, scheduler).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { ensureRuntime } = await import("@/lib/runtime/index");
    ensureRuntime();
  }
}
