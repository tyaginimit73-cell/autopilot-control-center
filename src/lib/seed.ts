import { db } from "@/db";
import { applicationProfiles, schedules, userSettings, workflows } from "@/db/schema";
import { computeNextRun } from "@/lib/runtime/scheduler";
import { ensureSimulatedDevice } from "@/lib/runtime/index";
import type { ActionType, ActionParams, WorkflowAction } from "@autopilot/shared";

const a = (type: ActionType, parameters: ActionParams, extra: Partial<WorkflowAction> = {}): WorkflowAction => ({
  id: crypto.randomUUID(),
  type,
  parameters,
  delay: 120,
  timeout: 15_000,
  retries: 0,
  enabled: true,
  ...extra,
});

/**
 * Starter content so a fresh account immediately has something meaningful to run,
 * edit, schedule and inspect. Nothing here touches a real machine: the seeded
 * "Pointer warm-up" workflow is dry-run by default.
 */
export async function seedWorkspace(userId: string) {
  const profiles = [
    { name: "Chrome", executablePath: "chrome.exe", arguments: [], category: "Browser" },
    { name: "Visual Studio Code", executablePath: "code.exe", arguments: [], category: "Development" },
    { name: "Windows Terminal", executablePath: "wt.exe", arguments: [], category: "Development" },
    { name: "Notepad", executablePath: "notepad.exe", arguments: [], category: "Utilities" },
  ];
  await db
    .insert(applicationProfiles)
    .values(profiles.map((p) => ({ ...p, userId, enabled: true })))
    .onConflictDoNothing();

  const daily = a("OPEN_URL", { url: "https://www.youtube.com" }, { note: "attach the browser session first" });
  const researchWorkflow: WorkflowAction[] = [
    a("OPEN_APPLICATION", { applicationId: "Chrome" }, { note: "bring the browser forward" }),
    a("WAIT", { milliseconds: 800 }),
    a("NEW_TAB", { url: "https://www.youtube.com" }),
    a("WAIT_FOR_PAGE", { value: "load" }),
    a("CLICK_ELEMENT", { selectorType: "role", value: "button", name: "Search" }, { retries: 1 }),
    a("TYPE_TEXT", { text: "automation tutorials", delayMs: 18 }),
    a("PRESS_KEY", { key: "ENTER" }),
    a("WAIT", { milliseconds: 1200 }),
    a("SWITCH_BROWSER_TAB", { tabId: "0" }),
    a("SCROLL_MOUSE", { direction: "down", amount: 4 }),
  ];

  const morningWorkflow: WorkflowAction[] = [
    a("OPEN_APPLICATION", { applicationId: "Visual Studio Code" }),
    a("MAXIMIZE_WINDOW", { windowId: "win-vscode" }),
    a("HOTKEY", { modifiers: ["CTRL"], key: "TAB" }, { note: "cycle editor tabs" }),
    a("OPEN_APPLICATION", { applicationId: "Windows Terminal" }),
    a("HOTKEY", { modifiers: ["CTRL", "SHIFT"], key: "T" }, { note: "new terminal tab" }),
    a("TYPE_TEXT", { text: "npm run dev:agent" }, { retries: 1 }),
    a("PRESS_KEY", { key: "ENTER" }),
    a("REPEAT", { times: 2, subActions: [a("WAIT", { milliseconds: 500 }), a("PRESS_KEY", { key: "F5" })] }, { note: "two refresh cycles" }),
  ];

  const pointerWorkflow: WorkflowAction[] = [
    a("MOVE_MOUSE", { x: 820, y: 430, durationMs: 900 }),
    a("CLICK_MOUSE", { button: "left" }),
    a("WAIT", { milliseconds: 400 }),
    a("MOVE_MOUSE", { x: 1240, y: 700, durationMs: 700 }),
    a("RIGHT_CLICK_MOUSE", {}),
    a("DRAG_MOUSE", { x: 1240, y: 700, toX: 980, toY: 320, durationMs: 900 }),
    a("CONDITION", { conditionKind: "mouseX", operator: "gt", compareValue: 900, skipIfFalse: 1 }),
    a("SCROLL_MOUSE", { direction: "up", amount: 3 }, { note: "skipped when the pointer is left of 900" }),
    a("MOVE_MOUSE", { x: 960, y: 540, durationMs: 600 }),
  ];

  const [w1] = await db
    .insert(workflows)
    .values({
      userId,
      name: "Daily Research Routine",
      description: "Opens Chrome, searches YouTube for automation tutorials, then tidies the tabs. DOM locators, not pixels.",
      actions: researchWorkflow,
      status: "ACTIVE",
      isDryRun: true,
    })
    .returning();

  await db.insert(workflows).values({
    userId,
    name: "Morning Workstation Setup",
    description: "Launches the editor and terminal, maximises windows and starts the agent watcher. Repeats two refresh cycles.",
    actions: morningWorkflow,
    status: "ACTIVE",
    isDryRun: true,
  });

  await db.insert(workflows).values({
    userId,
    name: "Pointer Warm-up (dry run)",
    description: "Safe demonstration of mouse, drag and conditional control flow. Runs in dry-run mode so nothing is committed.",
    actions: pointerWorkflow,
    status: "DRAFT",
    isDryRun: true,
  });

  const device = await ensureSimulatedDevice(userId);

  await db.insert(schedules).values({
    userId,
    workflowId: w1.id,
    deviceId: device.id,
    name: "Weekday 09:00 research",
    frequency: "DAILY",
    timeOfDay: "09:00",
    enabled: true,
    misfirePolicy: "SKIP",
    dryRun: true,
    nextRunAt: computeNextRun({
      frequency: "DAILY",
      timeOfDay: "09:00",
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
    } as never),
  });

  await db.insert(userSettings).values({ userId }).onConflictDoNothing();

  return { workflows: 3, profiles: profiles.length, device };
}
