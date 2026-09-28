/** Protocol + runtime constants shared by client, server and agent. */

export const APP_NAME = "AutoPilot Control Center";
export const APP_TAGLINE = "Control Your Digital Workspace";
export const AGENT_VERSION = "1.0.0";
export const PROTOCOL_VERSION = "1";

/** Pairing codes expire after this many milliseconds. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_CODE_PATTERN = /^PAIR-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Agent heartbeat cadence and the point at which a device is marked OFFLINE. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_TIMEOUT_MS = 16_000;

/** High frequency events are throttled so the dashboard never re-renders per pixel. */
export const MOUSE_REPORT_INTERVAL_MS = 250;
export const LOG_BUFFER_SIZE = 400;
export const SSE_KEEPALIVE_MS = 20_000;

export const DEFAULT_ACTION_DELAY_MS = 120;
export const DEFAULT_ACTION_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIES = 0;
export const MAX_ACTIONS_PER_WORKFLOW = 200;
export const MAX_SUB_ACTIONS = 40;

/** Hard limits used by both the API and the agent. */
export const MAX_TEXT_LENGTH = 4_000;
export const MAX_URL_LENGTH = 2_048;

/** Timeouts (ms) for the whole execution. */
export const MAX_EXECUTION_MS = 30 * 60 * 1000;

/** Rate limits (requests / window) */
export const RATE_LIMITS = {
  auth: { max: 12, windowMs: 10 * 60 * 1000 },
  automation: { max: 240, windowMs: 60 * 1000 },
  general: { max: 600, windowMs: 60 * 1000 },
} as const;

export const ERROR_MESSAGES: Record<string, string> = {
  AGENT_OFFLINE:
    "No agent is connected to this device. Start the local AutoPilot agent on your Windows PC and try again.",
  BROWSER_UNAVAILABLE:
    "The browser session is not available. Enable Playwright in the agent and attach or launch a Chromium-based browser.",
  APP_UNAVAILABLE:
    "That application profile is disabled or its executable path is not configured on this device.",
  INVALID_COORDINATE:
    "Coordinates must be integers inside the agent display resolution.",
  INVALID_SELECTOR: "The selector is empty or not a supported selector type.",
  ELEMENT_NOT_FOUND: "Element was not found before the timeout elapsed.",
  TIMEOUT: "The action exceeded its timeout.",
  UNAUTHORISED: "You need to sign in to perform this action.",
  FORBIDDEN: "You do not have permission to control this device.",
  PAIRING_FAILED: "Pairing failed: the code is invalid, expired, or already used.",
  RATE_LIMITED: "Too many requests. Please slow down.",
  CONFIRM_REQUIRED: "This action requires explicit confirmation.",
  DEVICE_BUSY: "This device is already running a workflow. Stop or wait for it before starting another.",
};

export const ROUTES = {
  landing: "/",
  login: "/login",
  register: "/register",
  dashboard: "/dashboard",
  automation: "/automation",
  workflows: "/workflows",
  recorder: "/recorder",
  browserControl: "/browser-control",
  desktopControl: "/desktop-control",
  schedules: "/schedules",
  history: "/history",
  devices: "/devices",
  settings: "/settings",
} as const;
