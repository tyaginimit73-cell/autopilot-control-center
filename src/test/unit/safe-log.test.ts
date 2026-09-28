/** Fix #2 (unit half): secret-bearing actions render as metadata, never raw values. */
import "../setup";
import { ACTION_CATALOG } from "@autopilot/shared";
import { describeActionSafe } from "@/lib/runtime/safe-log";
import { excludes, includes } from "../harness";

export const NAME = "unit/safe-log";

export async function run(): Promise<void> {
  // TYPE_TEXT: length only
  const secret = "Sup3rSecret!";
  const typed = describeActionSafe("TYPE_TEXT", { text: secret });
  includes(typed, `(${secret.length} chars, masked)`, "TYPE_TEXT shows length");
  excludes(typed, "Sup3rSecret!", "TYPE_TEXT hides raw text");
  excludes(typed, "Sup3r", "TYPE_TEXT hides partial text");

  // FILL_INPUT: locator + length only
  const formValue = "hunter2-hunter2";
  const filled = describeActionSafe("FILL_INPUT", { selector: "#password", selectorType: "css", value: formValue });
  includes(filled, "#password", "FILL_INPUT keeps locator for debugging");
  includes(filled, `(${formValue.length} chars, masked)`, "FILL_INPUT shows length");
  excludes(filled, "hunter2", "FILL_INPUT hides raw value");

  // URL actions: origin + path only (queries/fragments can carry tokens)
  const opened = describeActionSafe("OPEN_URL", { url: "https://app.example.com/callback?token=abc123&code=z#frag" });
  includes(opened, "https://app.example.com/callback", "OPEN_URL keeps origin + path");
  excludes(opened, "abc123", "OPEN_URL strips query secrets");
  excludes(opened, "frag", "OPEN_URL strips fragment");

  // Non-secret actions keep full detail (must not regress into over-masking)
  const moved = describeActionSafe("MOVE_MOUSE", { x: 120, y: 340 });
  if (moved !== ACTION_CATALOG.MOVE_MOUSE.summary({ x: 120, y: 340 })) {
    throw new Error(`CHECK FAILED: benign actions must keep catalog summaries, got ${JSON.stringify(moved)}`);
  }
  includes(moved, "120", "MOVE_MOUSE keeps coordinates");
}
