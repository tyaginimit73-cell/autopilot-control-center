import { ACTION_CATALOG } from "@autopilot/shared";
import type { ActionParams, ActionType } from "@autopilot/shared";

/**
 * Log-safe action descriptions.
 *
 * Workflow DEFINITIONS legitimately contain the author's own parameters (that is
 * the automation script). Execution/audit logs must never contain runtime
 * secrets, so this module is the single choke point for every log line, SSE
 * diagnostic message and error string derived from an action:
 *
 *  - TYPE_TEXT: length only, never the text
 *  - FILL_INPUT: locator + length only, never the value
 *  - OPEN_URL / NEW_TAB: origin + path only (query strings and fragments can
 *    carry session tokens)
 *  - everything else: the shared catalog summary (coordinates, keys, ids)
 */
export function describeActionSafe(type: ActionType, parameters: ActionParams): string {
  const params = (parameters ?? {}) as ActionParams;
  switch (type) {
    case "TYPE_TEXT": {
      const length = typeof params.text === "string" ? params.text.length : 0;
      return `Type text (${length} chars, masked)`;
    }
    case "FILL_INPUT": {
      const length = typeof params.value === "string" ? params.value.length : 0;
      return `Fill ${describeLocator(params)} (${length} chars, masked)`;
    }
    case "OPEN_URL":
      return `Open URL → ${safeUrl(params.url)}`;
    case "NEW_TAB":
      return `New tab → ${safeUrl(params.url ?? "about:blank")}`;
    default: {
      const def = ACTION_CATALOG[type];
      return def ? def.summary(params) : String(type);
    }
  }
}

function describeLocator(p: ActionParams): string {
  const selectorType = p.selectorType ?? "css";
  if (selectorType === "role") return `role name="${p.name ?? ""}"`.trim();
  if (selectorType === "label") return `label "${p.name ?? p.selector ?? ""}"`.trim();
  return `${selectorType} ${p.selector ?? p.name ?? ""}`.trim();
}

function safeUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "(unset)";
  if (raw === "about:blank") return raw;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(invalid url)";
  }
}
