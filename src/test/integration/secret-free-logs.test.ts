/** Fix #2 (integration half): STORED activity logs never contain typed text/form values. */
import "../setup";
import type { AgentCommand, AgentCommandResult } from "@autopilot/shared";
import { ensureDeviceRuntime, type DeviceLink } from "@/lib/runtime/host";
import { registerLink, startWorkflow, unregisterLink } from "@/lib/runtime/engine";
import { action, cleanupUser, readExecutionLogs, seedDevice, seedUser, seedWorkflow, waitForExecution } from "../fixtures";
import { check, eq, excludes, includes } from "../harness";

export const NAME = "integration/secret-free-logs";

// Fixed markers (not random): the test asserts exact masked lengths.
const TYPED_SECRET = "s3cr3t-typed-VALUE-001";
const FORM_SECRET = "f0rm-value-SECRET-002";

// The sim executes browser actions against real DOM state; this test targets the
// ENGINE's stored logs, so it uses a fake link that always succeeds.
function fakeLink(deviceId: string): DeviceLink {
  return {
    kind: "SIMULATED",
    deviceId,
    send: async (command: AgentCommand): Promise<AgentCommandResult> => ({
      commandId: command.id,
      ok: true,
      message: "fake-ok",
      durationMs: 1,
    }),
    emergencyStop: () => undefined,
    close: () => undefined,
  };
}

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const device = await seedDevice(user.id);
    ensureDeviceRuntime(device.id, user.id, "SIMULATED");
    registerLink(device.id, fakeLink(device.id));

    const workflow = await seedWorkflow(user.id, [
      action("TYPE_TEXT", { text: TYPED_SECRET }),
      action("FILL_INPUT", { selector: "#login", selectorType: "css", value: FORM_SECRET }),
    ]);
    const { execution } = await startWorkflow({ userId: user.id, workflowId: workflow.id, deviceId: device.id, dryRun: true });
    const final = await waitForExecution(execution.id);
    eq(final.status, "COMPLETED", "secret-bearing dry-run completes");

    const logs = await readExecutionLogs(execution.id);
    check(logs.length >= 2, `expected per-action log rows, got ${logs.length}`);
    const blob = logs.map((row) => `${row.message}\n${JSON.stringify(row.meta ?? {})}`).join("\n");
    excludes(blob, TYPED_SECRET, "typed text is absent from stored logs");
    excludes(blob, FORM_SECRET, "form value is absent from stored logs");
    excludes(blob, "s3cr3t", "no fragment of typed text leaks");
    excludes(String(final.error ?? ""), TYPED_SECRET, "typed text is absent from execution error");
    includes(blob, `(${TYPED_SECRET.length} chars, masked)`, "typed-text length is still audited");
    includes(blob, `(${FORM_SECRET.length} chars, masked)`, "form-value length is still audited");
    unregisterLink(device.id);
  } finally {
    await cleanupUser(user.id);
  }
}
