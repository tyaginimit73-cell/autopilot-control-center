import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { ActionParams, ActionType, ExecutionStep, WorkflowAction } from "@autopilot/shared";

export const roleEnum = pgEnum("user_role", ["USER", "ADMIN"]);
export const deviceStatusEnum = pgEnum("device_status", ["ONLINE", "OFFLINE", "PAIRING", "ERROR"]);
export const deviceKindEnum = pgEnum("device_kind", ["WINDOWS_AGENT", "SIMULATED"]);
export const workflowStatusEnum = pgEnum("workflow_status", ["DRAFT", "ACTIVE", "ARCHIVED"]);
export const executionStatusEnum = pgEnum("execution_status", [
  "IDLE",
  "RUNNING",
  "PAUSED",
  "STOPPING",
  "STOPPED",
  "COMPLETED",
  "FAILED",
]);
export const executionTriggerEnum = pgEnum("execution_trigger", ["MANUAL", "SCHEDULE", "RECORDING", "API"]);
export const logLevelEnum = pgEnum("log_level", ["DEBUG", "INFO", "WARN", "ERROR", "SUCCESS"]);
export const scheduleFreqEnum = pgEnum("schedule_frequency", ["ONCE", "DAILY", "WEEKLY", "INTERVAL", "CRON"]);
export const misfireEnum = pgEnum("misfire_policy", ["SKIP", "QUEUE"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("USER"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: deviceKindEnum("kind").notNull().default("WINDOWS_AGENT"),
    platform: text("platform").notNull().default("win32"),
    agentVersion: text("agent_version").notNull().default("—"),
    status: deviceStatusEnum("status").notNull().default("PAIRING"),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    pairingCode: text("pairing_code"),
    pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
    /** only the sha-256 of the device token is stored — the token itself is never persisted */
    tokenHash: text("token_hash"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    displayResolution: text("display_resolution"),
    ...timestamps(),
  },
  (t) => [
    index("devices_user_id_idx").on(t.userId),
    index("devices_status_idx").on(t.status),
    uniqueIndex("devices_pairing_code_idx").on(t.pairingCode),
  ],
);

export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    actions: jsonb("actions").$type<WorkflowAction[]>().notNull().default(sql`'[]'::jsonb`),
    status: workflowStatusEnum("status").notNull().default("DRAFT"),
    isDryRun: boolean("is_dry_run").notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("workflows_user_id_idx").on(t.userId), index("workflows_status_idx").on(t.status)],
);

export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: id(),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    workflowName: text("workflow_name").notNull().default("Workflow"),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    status: executionStatusEnum("status").notNull().default("IDLE"),
    trigger: executionTriggerEnum("trigger").notNull().default("MANUAL"),
    dryRun: boolean("dry_run").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    currentActionIndex: integer("current_action_index").notNull().default(0),
    totalActions: integer("total_actions").notNull().default(0),
    error: text("error"),
    steps: jsonb("steps").$type<ExecutionStep[]>().notNull().default(sql`'[]'::jsonb`),
    ...timestamps(),
  },
  (t) => [
    index("exec_user_idx").on(t.userId),
    index("exec_workflow_idx").on(t.workflowId),
    index("exec_device_idx").on(t.deviceId),
    index("exec_started_idx").on(sql`started_at desc`),
    index("exec_status_idx").on(t.status),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    frequency: scheduleFreqEnum("frequency").notNull().default("DAILY"),
    timeOfDay: text("time_of_day").notNull().default("09:00"),
    dayOfWeek: integer("day_of_week"),
    intervalMinutes: integer("interval_minutes"),
    cron: text("cron"),
    runAt: timestamp("run_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    misfirePolicy: misfireEnum("misfire_policy").notNull().default("SKIP"),
    dryRun: boolean("dry_run").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("schedules_user_idx").on(t.userId), index("schedules_next_idx").on(t.nextRunAt)],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    executionId: uuid("execution_id").references(() => workflowExecutions.id, { onDelete: "set null" }),
    level: logLevelEnum("level").notNull().default("INFO"),
    message: text("message").notNull(),
    actionType: text("action_type").$type<ActionType>(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("logs_user_idx").on(t.userId, t.createdAt), index("logs_exec_idx").on(t.executionId)],
);

export const applicationProfiles = pgTable(
  "application_profiles",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Paths are configured by the user and resolved by the agent on its own
     * machine. The server never executes them and never accepts a raw command.
     */
    executablePath: text("executable_path").notNull(),
    arguments: jsonb("arguments").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    category: text("category").notNull().default("General"),
    ...timestamps(),
  },
  (t) => [index("app_profiles_user_idx").on(t.userId)],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  defaultActionDelayMs: integer("default_action_delay_ms").notNull().default(120),
  defaultActionTimeoutMs: integer("default_action_timeout_ms").notNull().default(15000),
  defaultRetries: integer("default_retries").notNull().default(0),
  dryRunByDefault: boolean("dry_run_by_default").notNull().default(true),
  emergencyShortcut: text("emergency_shortcut").notNull().default("Ctrl+Shift+Esc"),
  mouseReportIntervalMs: integer("mouse_report_interval_ms").notNull().default(250),
  theme: text("theme").notNull().default("MIDNIGHT"),
  notifyOnFailure: boolean("notify_on_failure").notNull().default(true),
  notifyOnComplete: boolean("notify_on_complete").notNull().default(true),
  confirmDestructive: boolean("confirm_destructive").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recorderSessions = pgTable(
  "recorder_sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    status: text("status").notNull().default("RECORDING"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    capturedActions: jsonb("captured_actions").$type<{ type: ActionType; parameters: ActionParams }[]>().notNull().default(sql`'[]'::jsonb`),
    workflowId: uuid("workflow_id").references((): AnyPgColumn => workflows.id, { onDelete: "set null" }),
  },
  (t) => [index("recorder_user_idx").on(t.userId)],
);

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type WorkflowRow = typeof workflows.$inferSelect;
export type ExecutionRow = typeof workflowExecutions.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type LogRow = typeof activityLogs.$inferSelect;
export type ApplicationProfileRow = typeof applicationProfiles.$inferSelect;
export type SettingsRow = typeof userSettings.$inferSelect;
export type RecorderRow = typeof recorderSessions.$inferSelect;
