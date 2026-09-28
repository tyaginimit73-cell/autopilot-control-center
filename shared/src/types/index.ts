/**
 * Shared domain types for AutoPilot Control Center.
 * Consumed by the dashboard (client), the control-plane API (server) and the
 * local Windows automation agent (agent) so that all three agree on the wire
 * format. There is intentionally no `executeShell` style type anywhere: the
 * command union below is a closed allowlist.
 */

export type Role = "USER" | "ADMIN";

export type DeviceStatus = "ONLINE" | "OFFLINE" | "PAIRING" | "ERROR";
export type DeviceKind = "WINDOWS_AGENT" | "SIMULATED";

export type ExecutionStatus =
  | "IDLE"
  | "RUNNING"
  | "PAUSED"
  | "STOPPING"
  | "STOPPED"
  | "COMPLETED"
  | "FAILED";

export type WorkflowStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/** Every command the agent is allowed to execute. Closed set, validated twice. */
export type ActionType =
  // ── mouse ─────────────────────────────────────────────
  | "MOVE_MOUSE"
  | "CLICK_MOUSE"
  | "DOUBLE_CLICK_MOUSE"
  | "RIGHT_CLICK_MOUSE"
  | "SCROLL_MOUSE"
  | "DRAG_MOUSE"
  // ── keyboard ──────────────────────────────────────────
  | "TYPE_TEXT"
  | "PRESS_KEY"
  | "HOTKEY"
  // ── browser (Playwright / DOM first) ─────────────────
  | "OPEN_URL"
  | "NEW_TAB"
  | "SWITCH_BROWSER_TAB"
  | "RELOAD_TAB"
  | "CLOSE_TAB"
  | "WAIT_FOR_PAGE"
  | "WAIT_FOR_SELECTOR"
  | "CLICK_ELEMENT"
  | "FILL_INPUT"
  // ── desktop / windows ─────────────────────────────────
  | "OPEN_APPLICATION"
  | "FOCUS_WINDOW"
  | "MINIMIZE_WINDOW"
  | "MAXIMIZE_WINDOW"
  | "CLOSE_WINDOW"
  // ── control flow ──────────────────────────────────────
  | "WAIT"
  | "REPEAT"
  | "CONDITION"
  | "STOP";

export const ACTION_TYPES: readonly ActionType[] = [
  "MOVE_MOUSE",
  "CLICK_MOUSE",
  "DOUBLE_CLICK_MOUSE",
  "RIGHT_CLICK_MOUSE",
  "SCROLL_MOUSE",
  "DRAG_MOUSE",
  "TYPE_TEXT",
  "PRESS_KEY",
  "HOTKEY",
  "OPEN_URL",
  "NEW_TAB",
  "SWITCH_BROWSER_TAB",
  "RELOAD_TAB",
  "CLOSE_TAB",
  "WAIT_FOR_PAGE",
  "WAIT_FOR_SELECTOR",
  "CLICK_ELEMENT",
  "FILL_INPUT",
  "OPEN_APPLICATION",
  "FOCUS_WINDOW",
  "MINIMIZE_WINDOW",
  "MAXIMIZE_WINDOW",
  "CLOSE_WINDOW",
  "WAIT",
  "REPEAT",
  "CONDITION",
  "STOP",
] as const;

export type ActionGroup =
  | "mouse"
  | "keyboard"
  | "browser"
  | "desktop"
  | "control";

export type SelectorType = "css" | "text" | "role" | "label" | "placeholder";

/**
 * Flat, permissive parameter bag. The zod schema in ../schemas validates the
 * subset required by each concrete action type; the editor UI edits this flat
 * object directly which keeps the workflow builder simple and serialisable.
 */
export interface ActionParams {
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  durationMs?: number;
  button?: "left" | "right" | "middle";
  direction?: "up" | "down";
  amount?: number;
  text?: string;
  key?: string;
  modifiers?: string[];
  url?: string;
  tabId?: string;
  selectorType?: SelectorType;
  selector?: string;
  name?: string;
  value?: string;
  applicationId?: string;
  windowId?: string;
  milliseconds?: number;
  times?: number;
  subActions?: WorkflowAction[];
  conditionKind?:
    | "always"
    | "mouseX"
    | "mouseY"
    | "activeApp"
    | "browserTitle"
    | "browserUrl";
  operator?: "eq" | "neq" | "contains" | "gt" | "lt";
  compareValue?: string | number;
  skipIfFalse?: number;
  optional?: boolean;
  /** per-keystroke delay for TYPE_TEXT */
  delayMs?: number;
  /** open the URL in a fresh tab instead of navigating the active one */
  newTab?: boolean;
}

export interface WorkflowAction {
  id: string;
  type: ActionType;
  parameters: ActionParams;
  /** pause before executing this action (ms) */
  delay: number;
  /** per-action timeout (ms) */
  timeout: number;
  retries: number;
  enabled: boolean;
  note?: string;
}

export interface Workflow {
  id: string;
  userId: string;
  name: string;
  description: string;
  actions: WorkflowAction[];
  status: WorkflowStatus;
  isDryRun: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  userId: string;
  name: string;
  kind: DeviceKind;
  platform: string;
  agentVersion: string;
  status: DeviceStatus;
  lastSeen: string | null;
  createdAt: string;
  capabilities: string[];
  displayResolution: string | null;
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
  index: number;
  status: "open" | "loading" | "idle";
}

export interface DesktopWindow {
  id: string;
  application: string;
  title: string;
  processName: string;
  isFocused: boolean;
  state: "normal" | "minimized" | "maximized";
}

export interface ApplicationProfile {
  id: string;
  userId: string;
  name: string;
  executablePath: string;
  arguments: string[];
  enabled: boolean;
  category: string;
}

export interface AgentCommand {
  id: string;
  issuedAt?: string;
  executionId?: string;
  actionIndex?: number;
  dryRun: boolean;
  type: ActionType;
  parameters: ActionParams;
  timeoutMs: number;
}

export interface AgentCommandResult {
  commandId: string;
  ok: boolean;
  message: string;
  durationMs: number;
  data?: Record<string, unknown>;
}

export interface MousePosition {
  x: number;
  y: number;
  screenW: number;
  screenH: number;
  /** ms timestamp of the sample (used for throttling on the client) */
  at: number;
}

export interface SystemState {
  deviceId: string;
  mouse: MousePosition;
  activeWindow: DesktopWindow | null;
  windows: DesktopWindow[];
  tabs: BrowserTab[];
  activeTabId: string | null;
  browserConnected: boolean;
  browserName: string;
  automation: "RUNNING" | "IDLE" | "PAUSED";
  typedBuffer: string;
}

export type AutomationEvent =
  | { name: "agent:connected"; payload: { deviceId: string; deviceName: string } }
  | { name: "agent:disconnected"; payload: { deviceId: string; reason?: string } }
  | { name: "agent:heartbeat"; payload: { deviceId: string; at: string } }
  | {
      name:
        | "workflow:started"
        | "workflow:paused"
        | "workflow:resumed"
        | "workflow:stopping"
        | "workflow:stopped"
        | "workflow:completed"
        | "workflow:failed";
      payload: { executionId: string; workflowId: string; workflowName: string; deviceId: string; message?: string };
    }
  | {
      name: "action:started" | "action:completed" | "action:failed";
      payload: {
        executionId: string;
        index: number;
        total: number;
        actionId: string;
        actionType: ActionType;
        message: string;
      };
    }
  | { name: "mouse:position"; payload: MousePosition & { deviceId: string } }
  | { name: "browser:updated"; payload: { deviceId: string; tabs: BrowserTab[]; activeTabId: string | null; browserConnected: boolean; browserName: string } }
  | { name: "window:updated"; payload: { deviceId: string; windows: DesktopWindow[]; activeWindow: DesktopWindow | null } }
  | { name: "log:created"; payload: ActivityLog };

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";

export interface ActivityLog {
  id: string;
  userId: string | null;
  deviceId: string | null;
  workflowId: string | null;
  executionId: string | null;
  level: LogLevel;
  message: string;
  actionType: ActionType | null;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  userId: string;
  deviceId: string;
  status: ExecutionStatus;
  trigger: "MANUAL" | "SCHEDULE" | "RECORDING" | "API";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  currentActionIndex: number;
  totalActions: number;
  error: string | null;
}

export interface ExecutionStep {
  index: number;
  actionId: string;
  actionType: ActionType;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  message: string;
  durationMs: number | null;
  attempt: number;
}

export interface Schedule {
  id: string;
  userId: string;
  workflowId: string;
  deviceId: string;
  name: string;
  workflowName?: string;
  frequency: "ONCE" | "DAILY" | "WEEKLY" | "INTERVAL" | "CRON";
  timeOfDay: string;
  dayOfWeek: number | null;
  intervalMinutes: number | null;
  cron: string | null;
  runAt: string | null;
  enabled: boolean;
  misfirePolicy: "SKIP" | "QUEUE";
  dryRun: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface AutomationSettings {
  defaultActionDelayMs: number;
  defaultActionTimeoutMs: number;
  defaultRetries: number;
  dryRunByDefault: boolean;
  emergencyShortcut: string;
  mouseReportIntervalMs: number;
  theme: "MIDNIGHT" | "GRAPHITE";
  notifyOnFailure: boolean;
  notifyOnComplete: boolean;
  confirmDestructive: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}
