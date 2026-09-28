/** Fix #4 (unit half): explicit timeoutMs wins; control actions default 30 s, rest 15 s. */
import "../setup";
import { resolveCommandTimeoutMs } from "@/lib/runtime/engine";
import { eq } from "../harness";

export const NAME = "unit/timeout";

export async function run(): Promise<void> {
  // Explicit per-action timeout always wins (the old `??` + ternary chain dropped it).
  eq(resolveCommandTimeoutMs("TYPE_TEXT", 5_000), 5_000, "explicit timeout wins for normal actions");
  eq(resolveCommandTimeoutMs("CONDITION", 1_000), 1_000, "explicit timeout wins for control actions");
  eq(resolveCommandTimeoutMs("WAIT", 45_000), 45_000, "explicit timeout wins for WAIT");

  // Defaults by control flag.
  eq(resolveCommandTimeoutMs("TYPE_TEXT"), 15_000, "normal actions default to 15 s");
  eq(resolveCommandTimeoutMs("MOVE_MOUSE", undefined), 15_000, "undefined explicit falls back to 15 s");
  eq(resolveCommandTimeoutMs("CONDITION"), 30_000, "control actions default to 30 s");
  eq(resolveCommandTimeoutMs("WAIT"), 30_000, "WAIT defaults to 30 s");
  eq(resolveCommandTimeoutMs("STOP"), 30_000, "STOP defaults to 30 s");

  // Non-finite values are not real timeouts.
  eq(resolveCommandTimeoutMs("TYPE_TEXT", Number.NaN), 15_000, "NaN falls back to default");
}
