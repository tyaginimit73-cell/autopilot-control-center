/** Fix #7: pending-command cleanup is device-scoped; results are ownership-checked. */
import "../setup";
import { randomUUID } from "node:crypto";
import { ERROR_MESSAGES, type AgentCommand, type AgentCommandResult } from "@autopilot/shared";
import { getLink } from "@/lib/runtime/engine";
import { openAgentStream, resolveResult } from "@/lib/runtime/gateway";
import { cleanupUser, seedDevice, seedUser } from "../fixtures";
import { check, eq } from "../harness";

export const NAME = "integration/pending-scope";

function command(): AgentCommand {
  return {
    id: randomUUID(),
    issuedAt: new Date().toISOString(),
    dryRun: true,
    type: "TYPE_TEXT",
    parameters: { text: "x" },
    timeoutMs: 15_000,
  };
}

export async function run(): Promise<void> {
  const user = await seedUser();
  try {
    const deviceA = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "PAIRING", lastSeen: null });
    const deviceB = await seedDevice(user.id, { kind: "WINDOWS_AGENT", status: "PAIRING", lastSeen: null });
    const closeA = await openAgentStream(deviceA.id, user.id, () => undefined);
    const closeB = await openAgentStream(deviceB.id, user.id, () => undefined);
    const linkA = getLink(deviceA.id);
    const linkB = getLink(deviceB.id);
    if (!linkA || !linkB) throw new Error("agent links were not registered");

    const cmdA = command();
    const cmdB = command();
    const settledA = linkA.send(cmdA).then(
      () => "resolved",
      (error: Error) => error,
    );
    const settledB = linkB.send(cmdB).then(
      (result) => result,
      (error: Error) => error,
    );

    // Closing A must reject ONLY A's in-flight command (was: global pending.clear()).
    linkA.close();
    const outcomeA = await settledA;
    check(outcomeA instanceof Error, "A's pending command rejects on close");
    eq((outcomeA as Error).message, ERROR_MESSAGES.AGENT_OFFLINE, "A rejects with AGENT_OFFLINE");

    // Ownership: A cannot resolve B's command.
    const hijack: AgentCommandResult = { commandId: cmdB.id, ok: true, message: "forged", durationMs: 1 };
    eq(resolveResult(deviceA.id, cmdB.id, hijack), false, "cross-device resolve is refused");

    // B's command still completes normally afterwards.
    const legit: AgentCommandResult = { commandId: cmdB.id, ok: true, message: "done", durationMs: 3 };
    eq(resolveResult(deviceB.id, cmdB.id, legit), true, "own-device resolve succeeds");
    const outcomeB = await settledB;
    check(!(outcomeB instanceof Error), "B's pending command survives A's close (was: rejected)");
    eq((outcomeB as AgentCommandResult).message, "done", "B receives its own result");

    linkB.close();
    closeA();
    closeB();
    await new Promise((r) => setTimeout(r, 400));
  } finally {
    await cleanupUser(user.id);
  }
}
