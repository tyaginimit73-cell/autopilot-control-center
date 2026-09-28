/** Seed/cleanup helpers shared by the DB-backed integration tests. */
import "./setup";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, devices, users, workflowExecutions, workflows } from "@/db/schema";
import type { ActionParams, ActionType, WorkflowAction } from "@autopilot/shared";

export function action(type: ActionType, parameters: ActionParams = {}, extra: Partial<WorkflowAction> = {}): WorkflowAction {
  return { id: randomUUID(), type, parameters, delay: 0, timeout: 5000, retries: 0, enabled: true, ...extra };
}

export async function seedUser(email = `phase15-${randomUUID()}@example.com`) {
  const [row] = await db
    .insert(users)
    .values({ name: "phase15-test", email, passwordHash: "test-only-not-a-real-hash" })
    .returning();
  return row;
}

type DeviceStatus = typeof devices.$inferSelect.status;

export async function seedDevice(
  userId: string,
  opts: { kind?: "WINDOWS_AGENT" | "SIMULATED"; status?: DeviceStatus; lastSeen?: Date | null } = {},
) {
  const [row] = await db
    .insert(devices)
    .values({
      userId,
      name: `phase15-${randomUUID().slice(0, 8)}`,
      kind: opts.kind ?? "SIMULATED",
      status: opts.status ?? "ONLINE",
      lastSeen: opts.lastSeen === undefined ? new Date() : opts.lastSeen,
    })
    .returning();
  return row;
}

export async function seedWorkflow(userId: string, actions: WorkflowAction[], name = `phase15-${randomUUID().slice(0, 8)}`) {
  const [row] = await db
    .insert(workflows)
    .values({ userId, name, description: "", actions, status: "DRAFT", isDryRun: true })
    .returning();
  return row;
}

export async function cleanupUser(userId: string): Promise<void> {
  // Cascades to devices, workflows, executions, schedules and logs.
  await db.delete(users).where(eq(users.id, userId));
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "STOPPED"]);

export async function waitForExecution(executionId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db.select().from(workflowExecutions).where(eq(workflowExecutions.id, executionId));
    if (row && TERMINAL.has(row.status)) return row;
    if (Date.now() > deadline) throw new Error(`timed out waiting for execution ${executionId} (last status=${row?.status ?? "missing"})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function waitForStatus(executionId: string, status: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db.select().from(workflowExecutions).where(eq(workflowExecutions.id, executionId));
    if (row && row.status === status) return row;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${executionId} to become ${status} (last=${row?.status ?? "missing"})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function readExecutionLogs(executionId: string) {
  return db.select().from(activityLogs).where(eq(activityLogs.executionId, executionId));
}
