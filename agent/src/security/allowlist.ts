import { z } from "zod";

/**
 * Re-validation at the edge of the operating system.
 *
 * The control plane already validated the command; the agent validates it again so
 * that a tampered, replayed or compromised event-stream frame can never reach the
 * input layer. There is deliberately NO case here for shell, script, powershell,
 * executable path or URL-with-inline-command payloads.
 *
 * The 27 action types mirror `@autopilot/shared` (`ACTION_CATALOG`). This file is
 * intentionally self-contained (no runtime import of `../shared`) so the compiled
 * agent in `dist/` stays hermetic — see the comment on `SAFE_KEYS` below.
 */

export const ALLOWED = [
  "MOVE_MOUSE", "CLICK_MOUSE", "DOUBLE_CLICK_MOUSE", "RIGHT_CLICK_MOUSE", "SCROLL_MOUSE", "DRAG_MOUSE",
  "TYPE_TEXT", "PRESS_KEY", "HOTKEY",
  "OPEN_URL", "NEW_TAB", "SWITCH_BROWSER_TAB", "RELOAD_TAB", "CLOSE_TAB",
  "WAIT_FOR_PAGE", "WAIT_FOR_SELECTOR", "CLICK_ELEMENT", "FILL_INPUT",
  "OPEN_APPLICATION", "FOCUS_WINDOW", "MINIMIZE_WINDOW", "MAXIMIZE_WINDOW", "CLOSE_WINDOW",
  "WAIT", "REPEAT", "CONDITION", "STOP",
] as const;

export type AllowedActionType = (typeof ALLOWED)[number];

/**
 * Must stay identical to `SAFE_KEYS` in `shared/src/catalog/index.ts` (the source
 * of truth). Single letters are deliberately a subset, not A-Z: the server rejects
 * anything outside this list before the agent ever sees it.
 */
const SHARED_SAFE_KEYS = [
  "ENTER",
  "TAB",
  "ESCAPE",
  "BACKSPACE",
  "DELETE",
  "SPACE",
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "HOME",
  "END",
  "PAGEUP",
  "PAGEDOWN",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
  "A",
  "C",
  "V",
  "X",
  "Y",
  "Z",
  "F",
  "G",
  "N",
  "P",
  "R",
  "S",
  "T",
  "W",
] as const;

const SAFE_KEYS = new Set<string>(SHARED_SAFE_KEYS);
const SAFE_MODIFIERS = new Set(["CTRL", "ALT", "SHIFT", "META"]);

const params = z
  .object({
    x: z.number().int().min(0).max(8192).optional(),
    y: z.number().int().min(0).max(8192).optional(),
    toX: z.number().int().min(0).max(8192).optional(),
    toY: z.number().int().min(0).max(8192).optional(),
    durationMs: z.number().int().min(0).max(15000).optional(),
    delayMs: z.number().int().min(0).max(500).optional(),
    button: z.enum(["left", "right", "middle"]).optional(),
    direction: z.enum(["up", "down"]).optional(),
    amount: z.number().int().min(1).max(60).optional(),
    text: z.string().max(4000).optional(),
    key: z.string().max(16).optional(),
    modifiers: z.array(z.string().max(24)).max(3).optional(),
    url: z.string().max(2048).optional(),
    tabId: z.string().max(64).optional(),
    selectorType: z.enum(["css", "text", "role", "label", "placeholder"]).optional(),
    selector: z.string().max(512).optional(),
    name: z.string().max(160).optional(),
    value: z.string().max(2000).optional(),
    applicationId: z.string().max(128).optional(),
    windowId: z.string().max(128).optional(),
    milliseconds: z.number().int().min(0).max(600000).optional(),
    times: z.number().int().min(1).max(200).optional(),
    conditionKind: z.string().max(24).optional(),
    operator: z.string().max(12).optional(),
    compareValue: z.union([z.string().max(200), z.number()]).optional(),
    skipIfFalse: z.number().int().min(0).max(50).optional(),
    newTab: z.boolean().optional(),
  })
  .strict();

export const commandSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(ALLOWED),
  parameters: params.default({}),
  timeoutMs: z.number().int().min(250).max(300000).default(15000),
  dryRun: z.boolean().default(false),
  executionId: z.string().max(64).optional(),
  actionIndex: z.number().int().min(0).optional(),
  issuedAt: z.string().optional(),
});

export type AgentCommand = z.infer<typeof commandSchema>;

export interface ValidationReport {
  ok: boolean;
  command?: AgentCommand;
  reason?: string;
}

export interface Profile {
  id: string;
  executablePath: string;
  enabled?: boolean;
  name?: string;
  arguments?: string[];
}

/**
 * Validate an inbound command. The caller MUST pass the machine-local application
 * profiles (from `agent/src/config`) so `OPEN_APPLICATION` can only resolve to a
 * binary this machine was explicitly configured for. There is no global/profile
 * fallback: an empty list means "nothing is launchable".
 */
export function validate(command: unknown, profiles: Profile[] = []): ValidationReport {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "malformed command" };
  const cmd = parsed.data;
  const p = cmd.parameters;

  switch (cmd.type) {
    case "PRESS_KEY":
    case "HOTKEY": {
      if (!p.key || !SAFE_KEYS.has(p.key.toUpperCase())) return { ok: false, reason: `key "${p.key ?? ""}" is not allowlisted` };
      for (const modifier of p.modifiers ?? []) {
        // The dashboard offers compound presets such as "CTRL+ALT"; accept each leg.
        const legs = modifier.split("+").map((leg) => leg.trim().toUpperCase()).filter(Boolean);
        if (!legs.length) return { ok: false, reason: `modifier "${modifier}" is not allowlisted` };
        for (const leg of legs) {
          if (!SAFE_MODIFIERS.has(leg)) return { ok: false, reason: `modifier "${modifier}" is not allowlisted` };
        }
      }
      break;
    }
    case "OPEN_URL":
    case "NEW_TAB": {
      const url = p.url ?? "";
      if (url && !/^https?:\/\//i.test(url) && url !== "about:blank") return { ok: false, reason: "only http(s) URLs are accepted" };
      break;
    }
    case "OPEN_APPLICATION": {
      if (!p.applicationId) return { ok: false, reason: "applicationId is required" };
      const profile = findProfile(p.applicationId, profiles);
      if (!profile) return { ok: false, reason: `application profile "${p.applicationId}" is not configured on this machine` };
      break;
    }
    case "CLICK_ELEMENT":
    case "WAIT_FOR_SELECTOR":
    case "FILL_INPUT": {
      const selector = (p.selector ?? "").trim();
      const name = (p.name ?? "").trim();
      if ((p.selectorType ?? "css") === "role" ? !name : !selector) return { ok: false, reason: "missing locator" };
      if (/javascript:|data:text\/html/i.test(selector + name)) return { ok: false, reason: "suspicious locator payload" };
      break;
    }
    default:
      break;
  }
  return { ok: true, command: cmd };
}

export function findProfile(applicationId: string, extra: Profile[] = []) {
  const all = [...extra];
  return (
    all.find((profile) => profile.id === applicationId || (profile.name ?? "").toLowerCase() === applicationId.toLowerCase()) ?? null
  );
}
