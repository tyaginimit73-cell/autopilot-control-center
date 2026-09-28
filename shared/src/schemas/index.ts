import { z } from "zod";
import {
  DEFAULT_ACTION_DELAY_MS,
  DEFAULT_ACTION_TIMEOUT_MS,
  MAX_ACTIONS_PER_WORKFLOW,
  MAX_TEXT_LENGTH,
  MAX_URL_LENGTH,
  PAIRING_CODE_PATTERN,
} from "../constants";
import { ACTION_CATALOG, SAFE_KEYS, SAFE_MODIFIERS } from "../catalog";
import type { ActionType } from "../types";

/**
 * The command allowlist. Anything not represented here cannot reach the agent,
 * which is why there is no "run script", "shell" or "powershell" schema anywhere
 * in this project.
 */
export const ACTION_TYPE_LIST = Object.keys(ACTION_CATALOG) as [ActionType, ...ActionType[]];
export const actionTypeSchema = z.enum(ACTION_TYPE_LIST);

export const selectorTypeSchema = z.enum(["css", "text", "role", "label", "placeholder"]);

/** Parameters shared by every action (sub-actions may not nest further). */
const actionParamsBaseSchema = z
  .object({
    x: z.number().int().min(0).max(8192).optional(),
    y: z.number().int().min(0).max(8192).optional(),
    toX: z.number().int().min(0).max(8192).optional(),
    toY: z.number().int().min(0).max(8192).optional(),
    durationMs: z.number().int().min(0).max(15_000).optional(),
    delayMs: z.number().int().min(0).max(500).optional(),
    button: z.enum(["left", "right", "middle"]).optional(),
    direction: z.enum(["up", "down"]).optional(),
    amount: z.number().int().min(1).max(60).optional(),
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    key: z.enum(SAFE_KEYS).optional(),
    modifiers: z.array(z.enum(SAFE_MODIFIERS)).max(3).optional(),
    url: z.string().url().max(MAX_URL_LENGTH).or(z.literal("about:blank")).optional(),
    tabId: z.string().min(1).max(64).optional(),
    selectorType: selectorTypeSchema.optional(),
    selector: z.string().max(512).optional(),
    name: z.string().max(160).optional(),
    value: z.string().max(2000).optional(),
    applicationId: z.string().max(128).optional(),
    windowId: z.string().max(128).optional(),
    milliseconds: z.number().int().min(0).max(600_000).optional(),
    times: z.number().int().min(1).max(200).optional(),
    conditionKind: z.enum(["always", "mouseX", "mouseY", "activeApp", "browserTitle", "browserUrl"]).optional(),
    operator: z.enum(["eq", "neq", "contains", "gt", "lt"]).optional(),
    compareValue: z.union([z.string().max(200), z.number()]).optional(),
    skipIfFalse: z.number().int().min(0).max(50).optional(),
    optional: z.boolean().optional(),
    newTab: z.boolean().optional(),
  })
  .strict();

/** Required parameters per action type — validated before dispatch and again in the agent. */
export function validateParamsForType(type: ActionType, params: Record<string, unknown>): string | null {
  const def = ACTION_CATALOG[type];
  if (!def) return `Unsupported action type "${type}"`;
  for (const field of def.fields) {
    if (!field.required) continue;
    const value = params[field.key];
    if (value === undefined || value === null || value === "") {
      return `${def.label}: "${field.label}" is required`;
    }
  }
  switch (type) {
    case "OPEN_URL":
    case "NEW_TAB": {
      const url = String(params.url ?? "");
      if (url && !/^https?:\/\//i.test(url) && url !== "about:blank") {
        return "Only http(s) URLs can be opened by the browser controller";
      }
      return null;
    }
    case "HOTKEY": {
      const mods = (params.modifiers ?? []) as string[];
      if (!mods.length && !params.key) return "Hotkey requires at least a key";
      return null;
    }
    case "CLICK_ELEMENT":
    case "WAIT_FOR_SELECTOR": {
      const st = String(params.selectorType ?? "css");
      const sel = String(params.selector ?? "").trim();
      const name = String(params.name ?? "").trim();
      if (st === "role" ? !name : !sel) {
        return `${def.label}: provide a ${st === "role" ? "role name / accessible name" : "selector"}`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Single action shape without control-flow nesting (used by REPEAT.subActions). */
export const baseActionSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(ACTION_TYPE_LIST),
  parameters: actionParamsBaseSchema,
  delay: z.number().int().min(0).max(120_000).default(DEFAULT_ACTION_DELAY_MS),
  timeout: z.number().int().min(500).max(300_000).default(DEFAULT_ACTION_TIMEOUT_MS),
  retries: z.number().int().min(0).max(5).default(0),
  enabled: z.boolean().default(true),
  note: z.string().max(280).optional(),
});

export const actionParamsSchema = actionParamsBaseSchema
  .extend({
    subActions: z.array(baseActionSchema).max(40).optional(),
  })
  .strict();

export const workflowActionSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(ACTION_TYPE_LIST),
    parameters: actionParamsSchema,
    delay: z.number().int().min(0).max(120_000).default(DEFAULT_ACTION_DELAY_MS),
    timeout: z.number().int().min(500).max(300_000).default(DEFAULT_ACTION_TIMEOUT_MS),
    retries: z.number().int().min(0).max(5).default(0),
    enabled: z.boolean().default(true),
    note: z.string().max(280).optional(),
  })
  .superRefine((action, ctx) => {
    const error = validateParamsForType(action.type, action.parameters as Record<string, unknown>);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error, path: ["parameters"] });
  });

export const workflowUpsertSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(600).default(""),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  isDryRun: z.boolean().default(false),
  actions: z.array(workflowActionSchema).max(MAX_ACTIONS_PER_WORKFLOW).default([]),
});

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Tell us your name").max(80),
  email: z.string().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

export const pairingCodeSchema = z.string().regex(PAIRING_CODE_PATTERN, "Pairing codes look like PAIR-XXXX-XXXX");

export const agentPairSchema = z.object({
  pairingCode: pairingCodeSchema,
  deviceName: z.string().min(1).max(80),
  platform: z.string().min(1).max(60),
  agentVersion: z.string().min(1).max(32),
  capabilities: z.array(z.string().max(40)).max(20).default([]),
  displayResolution: z.string().max(32).optional(),
});

export const agentHelloSchema = z.object({
  deviceToken: z.string().min(20),
  platform: z.string().max(60).optional(),
  agentVersion: z.string().max(32).optional(),
  capabilities: z.array(z.string().max(40)).max(20).optional(),
  displayResolution: z.string().max(32).optional(),
});

export const deviceCreateSchema = z.object({
  name: z.string().min(2).max(80),
  platform: z.string().min(1).max(60).default("win32"),
});

export const browserOpenSchema = z.object({ url: z.string().url().max(MAX_URL_LENGTH), newTab: z.boolean().default(false) });
export const browserActSchema = z.object({
  action: z.enum(["reload", "back", "forward", "close", "activate"]),
  tabId: z.string().min(1).max(64).optional(),
});
export const browserElementSchema = z.object({
  kind: z.enum(["click", "fill", "waitFor"]),
  selectorType: selectorTypeSchema.default("css"),
  selector: z.string().max(512).optional(),
  name: z.string().max(160).optional(),
  value: z.string().max(2000).optional(),
  timeoutMs: z.number().int().min(500).max(120_000).optional(),
});

export const desktopFocusSchema = z.object({
  windowId: z.string().min(1).max(128),
  operation: z.enum(["focus", "minimize", "maximize", "close"]).default("focus"),
  confirm: z.boolean().default(false),
});

export const mouseCommandSchema = z.object({
  type: z.enum(["MOVE_MOUSE", "CLICK_MOUSE", "DOUBLE_CLICK_MOUSE", "RIGHT_CLICK_MOUSE", "SCROLL_MOUSE", "DRAG_MOUSE"]),
  parameters: actionParamsSchema,
});
export const keyboardCommandSchema = z.object({
  type: z.enum(["TYPE_TEXT", "PRESS_KEY", "HOTKEY"]),
  parameters: actionParamsSchema,
});

export const agentCommandSchema = z.object({
  id: z.string().min(1).max(64),
  issuedAt: z.string().optional(),
  executionId: z.string().max(64).optional(),
  actionIndex: z.number().int().min(0).max(100_000).optional(),
  dryRun: z.boolean().default(false),
  type: z.enum(ACTION_TYPE_LIST),
  parameters: actionParamsSchema,
  timeoutMs: z.number().int().min(250).max(300_000).default(DEFAULT_ACTION_TIMEOUT_MS),
});

export const agentPairingCodeResultSchema = z.object({ code: pairingCodeSchema });

export const applicationProfileSchema = z.object({
  name: z.string().min(2).max(80),
  executablePath: z
    .string()
    .min(3)
    .max(400)
    .regex(
      /^(?:[A-Za-z]:\\|\\\\|\/|[A-Za-z0-9._-]+\.exe$)/,
      "Use a full path (C:\\Program Files\\app.exe), a UNC path, or a bare executable name",
    ),
  arguments: z.array(z.string().max(200)).max(12).default([]),
  enabled: z.boolean().default(true),
  category: z.string().max(40).default("General"),
});

export const scheduleSchema = z.object({
  name: z.string().min(2).max(120),
  workflowId: z.string().min(1),
  deviceId: z.string().min(1),
  frequency: z.enum(["ONCE", "DAILY", "WEEKLY", "INTERVAL", "CRON"]),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  intervalMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
  cron: z.string().max(120).nullable().optional(),
  runAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T/).nullable().optional(),
  enabled: z.boolean().default(true),
  misfirePolicy: z.enum(["SKIP", "QUEUE"]).default("SKIP"),
  dryRun: z.boolean().default(false),
});

export const settingsSchema = z.object({
  defaultActionDelayMs: z.number().int().min(0).max(120_000).default(DEFAULT_ACTION_DELAY_MS),
  defaultActionTimeoutMs: z.number().int().min(500).max(300_000).default(DEFAULT_ACTION_TIMEOUT_MS),
  defaultRetries: z.number().int().min(0).max(5).default(0),
  dryRunByDefault: z.boolean().default(true),
  emergencyShortcut: z.string().min(3).max(60).default("Ctrl+Shift+Esc"),
  mouseReportIntervalMs: z.number().int().min(80).max(5000).default(250),
  theme: z.enum(["MIDNIGHT", "GRAPHITE"]).default("MIDNIGHT"),
  notifyOnFailure: z.boolean().default(true),
  notifyOnComplete: z.boolean().default(true),
  confirmDestructive: z.boolean().default(true),
});

export const startWorkflowSchema = z.object({
  deviceId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export type WorkflowUpsertInput = z.infer<typeof workflowUpsertSchema>;
export type AgentCommandInput = z.infer<typeof agentCommandSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type ApplicationProfileInput = z.infer<typeof applicationProfileSchema>;
