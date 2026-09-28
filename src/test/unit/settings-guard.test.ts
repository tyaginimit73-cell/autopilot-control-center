/** Fix #11 (snippet guard): agent .env example uses the real origin + correct variable name. */
import "../setup";
import fs from "node:fs";
import path from "node:path";
import { excludes, includes } from "../harness";

export const NAME = "unit/settings-guard";

export async function run(): Promise<void> {
  const file = fs.readFileSync(path.join(__dirname, "..", "..", "app", "(app)", "settings", "page.tsx"), "utf8");

  includes(file, "EMERGENCY_SHORTCUT", "example exports EMERGENCY_SHORTCUT");
  excludes(file, "EMERGENCY_SHORTCODE", "typo EMERGENCY_SHORTCODE is gone");
  excludes(file, 'replace("5173", "4000")', "no port-rewrite hack for SERVER_URL");
  excludes(file, "localhost:4000", "no hardcoded :4000 fallback");
  includes(file, "window.location.origin", "SERVER_URL derives from the actual origin");
}
