CREATE TYPE "public"."device_kind" AS ENUM('WINDOWS_AGENT', 'SIMULATED');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('ONLINE', 'OFFLINE', 'PAIRING', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('IDLE', 'RUNNING', 'PAUSED', 'STOPPING', 'STOPPED', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."execution_trigger" AS ENUM('MANUAL', 'SCHEDULE', 'RECORDING', 'API');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('DEBUG', 'INFO', 'WARN', 'ERROR', 'SUCCESS');--> statement-breakpoint
CREATE TYPE "public"."misfire_policy" AS ENUM('SKIP', 'QUEUE');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."schedule_frequency" AS ENUM('ONCE', 'DAILY', 'WEEKLY', 'INTERVAL', 'CRON');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('DRAFT', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"workflow_id" uuid,
	"execution_id" uuid,
	"level" "log_level" DEFAULT 'INFO' NOT NULL,
	"message" text NOT NULL,
	"action_type" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"executable_path" text NOT NULL,
	"arguments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "device_kind" DEFAULT 'WINDOWS_AGENT' NOT NULL,
	"platform" text DEFAULT 'win32' NOT NULL,
	"agent_version" text DEFAULT '—' NOT NULL,
	"status" "device_status" DEFAULT 'PAIRING' NOT NULL,
	"last_seen" timestamp with time zone,
	"pairing_code" text,
	"pairing_expires_at" timestamp with time zone,
	"token_hash" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recorder_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"status" text DEFAULT 'RECORDING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"captured_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workflow_id" uuid
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"name" text NOT NULL,
	"frequency" "schedule_frequency" DEFAULT 'DAILY' NOT NULL,
	"time_of_day" text DEFAULT '09:00' NOT NULL,
	"day_of_week" integer,
	"interval_minutes" integer,
	"cron" text,
	"run_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"misfire_policy" "misfire_policy" DEFAULT 'SKIP' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_action_delay_ms" integer DEFAULT 120 NOT NULL,
	"default_action_timeout_ms" integer DEFAULT 15000 NOT NULL,
	"default_retries" integer DEFAULT 0 NOT NULL,
	"dry_run_by_default" boolean DEFAULT true NOT NULL,
	"emergency_shortcut" text DEFAULT 'Ctrl+Shift+Esc' NOT NULL,
	"mouse_report_interval_ms" integer DEFAULT 250 NOT NULL,
	"theme" text DEFAULT 'MIDNIGHT' NOT NULL,
	"notify_on_failure" boolean DEFAULT true NOT NULL,
	"notify_on_complete" boolean DEFAULT true NOT NULL,
	"confirm_destructive" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid,
	"workflow_name" text DEFAULT 'Workflow' NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"status" "execution_status" DEFAULT 'IDLE' NOT NULL,
	"trigger" "execution_trigger" DEFAULT 'MANUAL' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"current_action_index" integer DEFAULT 0 NOT NULL,
	"total_actions" integer DEFAULT 0 NOT NULL,
	"error" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "workflow_status" DEFAULT 'DRAFT' NOT NULL,
	"is_dry_run" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_profiles" ADD CONSTRAINT "application_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorder_sessions" ADD CONSTRAINT "recorder_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorder_sessions" ADD CONSTRAINT "recorder_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorder_sessions" ADD CONSTRAINT "recorder_sessions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "logs_user_idx" ON "activity_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "logs_exec_idx" ON "activity_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "app_profiles_user_idx" ON "application_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_status_idx" ON "devices" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_pairing_code_idx" ON "devices" USING btree ("pairing_code");--> statement-breakpoint
CREATE INDEX "recorder_user_idx" ON "recorder_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "schedules_user_idx" ON "schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "schedules_next_idx" ON "schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "exec_user_idx" ON "workflow_executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exec_workflow_idx" ON "workflow_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "exec_device_idx" ON "workflow_executions" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "exec_started_idx" ON "workflow_executions" USING btree (started_at desc);--> statement-breakpoint
CREATE INDEX "exec_status_idx" ON "workflow_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflows_user_id_idx" ON "workflows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflows_status_idx" ON "workflows" USING btree ("status");