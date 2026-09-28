/** Fix #10: emptyState parses width AND height (screenH used to read the width slot). */
import "../setup";
import { emptyState } from "@/lib/runtime/host";
import { eq } from "../harness";

export const NAME = "unit/empty-state";

export async function run(): Promise<void> {
  const def = emptyState("dev-default");
  eq(def.mouse.screenW, 1920, "default width");
  eq(def.mouse.screenH, 1080, "default height (was 1920 — the bug)");
  eq(def.mouse.x, 960, "pointer starts centred x");
  eq(def.mouse.y, 540, "pointer starts centred y");

  const custom = emptyState("dev-custom", "1366x768");
  eq(custom.mouse.screenW, 1366, "custom width");
  eq(custom.mouse.screenH, 768, "custom height");
  eq(custom.mouse.x, 683, "custom centred x");
  eq(custom.mouse.y, 384, "custom centred y");

  // Malformed input must not produce NaN viewports.
  for (const bad of ["garbage", "", "1920", "x", "0x0", "-3x-4"]) {
    const state = emptyState("dev-bad", bad);
    eq(state.mouse.screenW, 1920, `bad resolution ${JSON.stringify(bad)} falls back width`);
    eq(state.mouse.screenH, 1080, `bad resolution ${JSON.stringify(bad)} falls back height`);
  }
}
