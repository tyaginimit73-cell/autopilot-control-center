import type { ActionGroup, ActionType, ActionParams } from "../types";

/**
 * The action catalog is the single source of truth for:
 *  - the workflow builder palette + parameter forms
 *  - server-side validation metadata
 *  - human readable log lines ("Moving mouse → 800,500")
 *  - the agent's command allowlist (a type not in this catalog is rejected)
 */

export type FieldType = "number" | "text" | "textarea" | "select" | "toggle";

export interface ActionField {
  key: keyof ActionParams & string;
  label: string;
  type: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
}

export interface ActionDefinition {
  type: ActionType;
  group: ActionGroup;
  label: string;
  description: string;
  icon: string;
  fields: ActionField[];
  defaults: ActionParams;
  /** requires a confirmation dialog before it can run outside of a workflow */
  destructive?: boolean;
  /** only runnable when an application profile / browser is attached */
  requiresProfile?: boolean;
  /** used by the workflow engine for control flow, never dispatched to the agent */
  control?: boolean;
  summary: (p: ActionParams) => string;
}

export const ACTION_GROUPS: { id: ActionGroup; label: string; icon: string; accent: string }[] = [
  { id: "mouse", label: "Mouse", icon: "mouse-pointer", accent: "text-cyan-300" },
  { id: "keyboard", label: "Keyboard", icon: "keyboard", accent: "text-violet-300" },
  { id: "browser", label: "Browser", icon: "globe", accent: "text-emerald-300" },
  { id: "desktop", label: "Desktop", icon: "app-window", accent: "text-amber-300" },
  { id: "control", label: "Control", icon: "git-branch", accent: "text-rose-300" },
];

const BUTTONS = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "middle", label: "Middle" },
];

const SELECTORS = [
  { value: "css", label: "CSS selector" },
  { value: "text", label: "Text content" },
  { value: "role", label: "ARIA role" },
  { value: "label", label: "Label" },
  { value: "placeholder", label: "Placeholder" },
];

export const SAFE_KEYS = [
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

export const SAFE_MODIFIERS = ["CTRL", "ALT", "SHIFT", "META"] as const;

const f = {
  x: (label = "X"): ActionField => ({ key: "x", label, type: "number", min: 0, max: 8192, required: true, unit: "px" }),
  y: (label = "Y"): ActionField => ({ key: "y", label, type: "number", min: 0, max: 8192, required: true, unit: "px" }),
  duration: {
    key: "durationMs",
    label: "Move duration",
    type: "number",
    min: 0,
    max: 15_000,
    step: 50,
    unit: "ms",
    hint: "0 makes the pointer jump instantly",
  } as ActionField,
  button: { key: "button", label: "Button", type: "select", options: BUTTONS } as ActionField,
  text: {
    key: "text",
    label: "Text",
    type: "textarea",
    required: true,
    max: 4000,
    placeholder: "Text to type",
    hint: "Password fields typed while recording are masked automatically",
  } as ActionField,
  url: { key: "url", label: "URL", type: "text", required: true, placeholder: "https://example.com" } as ActionField,
};

export const ACTION_CATALOG: Record<ActionType, ActionDefinition> = {
  MOVE_MOUSE: {
    type: "MOVE_MOUSE",
    group: "mouse",
    label: "Move",
    description: "Smoothly move the hardware pointer to absolute screen coordinates.",
    icon: "move",
    fields: [f.x(), f.y(), f.duration],
    defaults: { x: 800, y: 500, durationMs: 600 },
    summary: (p) => `Move mouse → ${p.x ?? 0},${p.y ?? 0}`,
  },
  CLICK_MOUSE: {
    type: "CLICK_MOUSE",
    group: "mouse",
    label: "Click",
    description: "Click a mouse button at the current pointer position.",
    icon: "mouse-pointer-click",
    fields: [f.button, { key: "x", label: "Optional X", type: "number", min: 0, max: 8192, unit: "px" }, { key: "y", label: "Optional Y", type: "number", min: 0, max: 8192, unit: "px" }],
    defaults: { button: "left" },
    summary: (p) => `Click → ${p.button ?? "left"}`,
  },
  DOUBLE_CLICK_MOUSE: {
    type: "DOUBLE_CLICK_MOUSE",
    group: "mouse",
    label: "Double click",
    description: "Double-click the left mouse button.",
    icon: "mouse-pointer-click",
    fields: [],
    defaults: { button: "left" },
    summary: () => `Double click → left`,
  },
  RIGHT_CLICK_MOUSE: {
    type: "RIGHT_CLICK_MOUSE",
    group: "mouse",
    label: "Right click",
    description: "Open context menus with a right click.",
    icon: "mouse-pointer-2",
    fields: [],
    defaults: { button: "right" },
    summary: () => `Right click`,
  },
  SCROLL_MOUSE: {
    type: "SCROLL_MOUSE",
    group: "mouse",
    label: "Scroll",
    description: "Scroll the wheel under the pointer.",
    icon: "arrows-up-down",
    fields: [
      { key: "direction", label: "Direction", type: "select", options: [{ value: "up", label: "Up" }, { value: "down", label: "Down" }] },
      { key: "amount", label: "Notches", type: "number", min: 1, max: 60, step: 1 },
    ],
    defaults: { direction: "down", amount: 3 },
    summary: (p) => `Scroll ${p.direction ?? "down"} ×${p.amount ?? 3}`,
  },
  DRAG_MOUSE: {
    type: "DRAG_MOUSE",
    group: "mouse",
    label: "Drag",
    description: "Press at the origin, move, release at the destination.",
    icon: "hand",
    fields: [
      f.x("From X"),
      f.y("From Y"),
      { key: "toX", label: "To X", type: "number", min: 0, max: 8192, required: true, unit: "px" },
      { key: "toY", label: "To Y", type: "number", min: 0, max: 8192, required: true, unit: "px" },
      f.duration,
    ],
    defaults: { x: 400, y: 400, toX: 900, toY: 600, durationMs: 800 },
    summary: (p) => `Drag (${p.x},${p.y}) → (${p.toX},${p.toY})`,
  },
  TYPE_TEXT: {
    type: "TYPE_TEXT",
    group: "keyboard",
    label: "Type text",
    description: "Type a string into the focused control using the OS keyboard.",
    icon: "text-cursor-input",
    fields: [
      f.text,
      { key: "delayMs", label: "Keystroke delay", type: "number", min: 0, max: 500, step: 5, unit: "ms" } as ActionField,
    ],
    defaults: { text: "", durationMs: 15 },
    summary: (p) => `Type "${(p.text ?? "").slice(0, 28)}${(p.text ?? "").length > 28 ? "…" : ""}"`,
  },
  PRESS_KEY: {
    type: "PRESS_KEY",
    group: "keyboard",
    label: "Press key",
    description: "Press a single named key (allowlisted, no raw keycodes).",
    icon: "corner-down-left",
    fields: [
      { key: "key", label: "Key", type: "select", required: true, options: SAFE_KEYS.map((k) => ({ value: k, label: k })) },
    ],
    defaults: { key: "ENTER" },
    summary: (p) => `Press ${p.key ?? "ENTER"}`,
  },
  HOTKEY: {
    type: "HOTKEY",
    group: "keyboard",
    label: "Hotkey",
    description: "Press a modifier combination such as CTRL+ALT+TAB.",
    icon: "command",
    fields: [
      {
        key: "modifiers" as keyof ActionParams & string,
        label: "Modifiers",
        type: "select",
        required: true,
        options: [
          { value: "CTRL", label: "CTRL" },
          { value: "CTRL+ALT", label: "CTRL + ALT" },
          { value: "CTRL+SHIFT", label: "CTRL + SHIFT" },
          { value: "CTRL+ALT+DELETE", label: "CTRL + ALT + DELETE" },
          { value: "ALT", label: "ALT" },
          { value: "META", label: "META (Win)" },
          { value: "SHIFT", label: "SHIFT" },
        ],
      },
      { key: "key", label: "Key", type: "select", required: true, options: SAFE_KEYS.map((k) => ({ value: k, label: k })) },
    ],
    defaults: { modifiers: ["CTRL"], key: "C" },
    summary: (p) => `Hotkey ${(p.modifiers ?? []).join(" + ")}${p.modifiers?.length ? " + " : ""}${p.key ?? ""}`,
  },
  OPEN_URL: {
    type: "OPEN_URL",
    group: "browser",
    label: "Open URL",
    description: "Navigate the active tab (or a new tab) to a URL via Playwright.",
    icon: "link",
    fields: [f.url, { key: "newTab", label: "Open in new tab", type: "toggle" } as ActionField],
    defaults: { url: "https://example.com", optional: false },
    requiresProfile: true,
    summary: (p) => `Open URL → ${p.url ?? ""}`,
  },
  NEW_TAB: {
    type: "NEW_TAB",
    group: "browser",
    label: "New tab",
    description: "Create a new browser tab.",
    icon: "plus",
    fields: [f.url],
    defaults: { url: "about:blank" },
    summary: (p) => `New tab → ${p.url || "about:blank"}`,
  },
  SWITCH_BROWSER_TAB: {
    type: "SWITCH_BROWSER_TAB",
    group: "browser",
    label: "Switch tab",
    description: "Bring a tab to the foreground.",
    icon: "panels-top-left",
    fields: [{ key: "tabId", label: "Tab id / index", type: "text", required: true, placeholder: "tab-2 or 2" }],
    defaults: { tabId: "0" },
    summary: (p) => `Switch tab → ${p.tabId ?? "0"}`,
  },
  RELOAD_TAB: {
    type: "RELOAD_TAB",
    group: "browser",
    label: "Reload",
    description: "Reload the active tab.",
    icon: "rotate-cw",
    fields: [],
    defaults: {},
    summary: () => `Reload active tab`,
  },
  CLOSE_TAB: {
    type: "CLOSE_TAB",
    group: "browser",
    label: "Close tab",
    description: "Close a tab (never closes the last remaining tab).",
    icon: "x",
    fields: [{ key: "tabId", label: "Tab id / index", type: "text", placeholder: "defaults to active tab" }],
    defaults: {},
    destructive: true,
    summary: (p) => `Close tab → ${p.tabId ?? "active"}`,
  },
  WAIT_FOR_PAGE: {
    type: "WAIT_FOR_PAGE",
    group: "browser",
    label: "Wait for page",
    description: "Wait until the page reaches a lifecycle state.",
    icon: "loader",
    fields: [
      {
        key: "value",
        label: "State",
        type: "select",
        options: [
          { value: "load", label: "load" },
          { value: "domcontentloaded", label: "domcontentloaded" },
          { value: "networkidle", label: "networkidle" },
        ],
      },
    ],
    defaults: { value: "load" },
    summary: (p) => `Wait for page → ${p.value ?? "load"}`,
  },
  WAIT_FOR_SELECTOR: {
    type: "WAIT_FOR_SELECTOR",
    group: "browser",
    label: "Wait for selector",
    description: "Wait until an element exists / becomes visible.",
    icon: "crosshair",
    fields: [
      { key: "selectorType", label: "Locator", type: "select", options: SELECTORS },
      { key: "selector", label: "Selector", type: "text", required: true, placeholder: 'button[data-testid="login"]' },
    ],
    defaults: { selectorType: "css", selector: "" },
    summary: (p) => `Wait for ${p.selectorType ?? "css"} ${p.selector ?? ""}`,
  },
  CLICK_ELEMENT: {
    type: "CLICK_ELEMENT",
    group: "browser",
    label: "Click element",
    description: "DOM-first click. Preferred over absolute coordinates.",
    icon: "mouse-pointer-click",
    fields: [
      { key: "selectorType", label: "Locator", type: "select", options: SELECTORS },
      { key: "selector", label: "Selector", type: "text", placeholder: "[data-testid=submit]" },
      { key: "name", label: "Accessible name", type: "text", placeholder: "Submit (role/label locators)" },
    ],
    defaults: { selectorType: "role", name: "Submit", value: "button" },
    summary: (p) => `Click ${p.selectorType ?? "css"} ${p.selector ?? p.name ?? ""}`,
  },
  FILL_INPUT: {
    type: "FILL_INPUT",
    group: "browser",
    label: "Fill input",
    description: "Set the value of an input using a locator.",
    icon: "form-input",
    fields: [
      { key: "selectorType", label: "Locator", type: "select", options: SELECTORS },
      { key: "selector", label: "Selector", type: "text", required: true, placeholder: "#search" },
      { key: "value", label: "Value", type: "text", required: true },
    ],
    defaults: { selectorType: "css", selector: "#search", value: "" },
    summary: (p) => `Fill ${p.selector ?? ""} = "${(p.value ?? "").slice(0, 20)}"`,
  },
  OPEN_APPLICATION: {
    type: "OPEN_APPLICATION",
    group: "desktop",
    label: "Open application",
    description: "Launch a user-configured application profile. Arbitrary paths are rejected.",
    icon: "rocket",
    fields: [
      { key: "applicationId", label: "Application profile", type: "text", required: true, placeholder: "app-chrome", hint: "Configured in Devices → Application profiles" },
    ],
    defaults: { applicationId: "" },
    requiresProfile: true,
    summary: (p) => `Open application → ${p.applicationId ?? "(unset)"}`,
  },
  FOCUS_WINDOW: {
    type: "FOCUS_WINDOW",
    group: "desktop",
    label: "Focus application",
    description: "Bring a window to the foreground.",
    icon: "app-window",
    fields: [{ key: "windowId", label: "Window id", type: "text", required: true }],
    defaults: { windowId: "" },
    summary: (p) => `Focus window → ${p.windowId ?? "(unset)"}`,
  },
  MINIMIZE_WINDOW: {
    type: "MINIMIZE_WINDOW",
    group: "desktop",
    label: "Minimise",
    description: "Minimise a window.",
    icon: "minus",
    fields: [{ key: "windowId", label: "Window id", type: "text", required: true }],
    defaults: {},
    summary: (p) => `Minimise ${p.windowId ?? "active window"}`,
  },
  MAXIMIZE_WINDOW: {
    type: "MAXIMIZE_WINDOW",
    group: "desktop",
    label: "Maximise",
    description: "Maximise a window.",
    icon: "maximize",
    fields: [{ key: "windowId", label: "Window id", type: "text", required: true }],
    defaults: {},
    summary: (p) => `Maximise ${p.windowId ?? "active window"}`,
  },
  CLOSE_WINDOW: {
    type: "CLOSE_WINDOW",
    group: "desktop",
    label: "Close window",
    description: "Ask a window to close. Always requires confirmation.",
    icon: "square-x",
    fields: [{ key: "windowId", label: "Window id", type: "text", required: true }],
    defaults: {},
    destructive: true,
    summary: (p) => `Close ${p.windowId ?? "active window"}`,
  },
  WAIT: {
    type: "WAIT",
    group: "control",
    label: "Delay",
    description: "Pause the workflow for a fixed time.",
    icon: "timer",
    fields: [{ key: "milliseconds", label: "Duration", type: "number", min: 0, max: 600_000, step: 100, unit: "ms", required: true }],
    defaults: { milliseconds: 1000 },
    control: true,
    summary: (p) => `Wait ${p.milliseconds ?? 0}ms`,
  },
  REPEAT: {
    type: "REPEAT",
    group: "control",
    label: "Repeat",
    description: "Repeat an inline group of sub-actions N times.",
    icon: "repeat",
    fields: [{ key: "times", label: "Times", type: "number", min: 1, max: 200, step: 1, required: true }],
    defaults: { times: 2, subActions: [] },
    control: true,
    summary: (p) => `Repeat ×${p.times ?? 1} (${p.subActions?.length ?? 0} actions)`,
  },
  CONDITION: {
    type: "CONDITION",
    group: "control",
    label: "Condition",
    description: "Evaluate live state; optionally skip the following N actions when false.",
    icon: "git-branch",
    fields: [
      {
        key: "conditionKind",
        label: "Source",
        type: "select",
        options: [
          { value: "always", label: "Always true" },
          { value: "mouseX", label: "Pointer X" },
          { value: "mouseY", label: "Pointer Y" },
          { value: "activeApp", label: "Active application" },
          { value: "browserTitle", label: "Browser tab title" },
          { value: "browserUrl", label: "Browser URL" },
        ],
      },
      {
        key: "operator",
        label: "Operator",
        type: "select",
        options: [
          { value: "eq", label: "equals" },
          { value: "neq", label: "not equals" },
          { value: "contains", label: "contains" },
          { value: "gt", label: "greater than" },
          { value: "lt", label: "less than" },
        ],
      },
      { key: "compareValue", label: "Compare to", type: "text" },
      { key: "skipIfFalse", label: "Skip N actions when false", type: "number", min: 0, max: 50, step: 1 },
    ],
    defaults: { conditionKind: "always", operator: "contains", compareValue: "", skipIfFalse: 0 },
    control: true,
    summary: (p) => `Condition ${p.conditionKind ?? "always"} ${p.operator ?? ""} ${p.compareValue ?? ""}`.trim(),
  },
  STOP: {
    type: "STOP",
    group: "control",
    label: "Stop workflow",
    description: "End the execution immediately and mark it completed.",
    icon: "octagon-x",
    fields: [],
    defaults: {},
    control: true,
    summary: () => `Stop workflow`,
  },
};

export const ACTION_LIST = Object.values(ACTION_CATALOG);
export const ACTIONS_BY_GROUP = ACTION_GROUPS.map((g) => ({
  ...g,
  actions: ACTION_LIST.filter((a) => a.group === g.id),
}));

export function describeAction(action: { type: ActionType; parameters: ActionParams }): string {
  const def = ACTION_CATALOG[action.type];
  return def ? def.summary(action.parameters) : String(action.type);
}
