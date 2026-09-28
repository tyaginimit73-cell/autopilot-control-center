/**
 * Phase 1.5 regression suite runner (serial, no runner dependency).
 * Unit tests always run; integration tests run when DATABASE_URL or
 * PGLITE_DATA_DIR is configured and skip otherwise.
 */
import "./setup";
import { closeTestDb, dbAvailable, ensureTestDb } from "./setup";

const UNIT = [
  "./unit/safe-log.test",
  "./unit/timeout.test",
  "./unit/empty-state.test",
  "./unit/schedule-once.test",
  "./unit/settings-guard.test",
];

const INTEGRATION = [
  "./integration/no-estop-on-complete.test",
  "./integration/estop-emits.test",
  "./integration/stop-not-failed.test",
  "./integration/timeout-propagated.test",
  "./integration/paused-estop.test",
  "./integration/once-nextrun.test",
  "./integration/null-lastseen-stale.test",
  "./integration/delete-guard.test",
  "./integration/secret-free-logs.test",
  "./integration/agent-online.test",
  "./integration/pending-scope.test",
  "./integration/dryrun-workflow.test",
  "./integration/pairing-security.test",
  "./integration/agent-auth.test",
];

interface TestModule {
  NAME?: string;
  run: () => Promise<void>;
}

async function runFile(file: string): Promise<string | null> {
  const mod = (await import(file)) as TestModule;
  const name = mod.NAME ?? file;
  try {
    await mod.run();
    console.log(`PASS ${name}`);
    return null;
  } catch (error) {
    console.error(`FAIL ${name}\n  ${((error as Error).stack ?? String(error)).split("\n").slice(0, 4).join("\n  ")}`);
    return `${name}: ${(error as Error).message}`;
  }
}

async function main(): Promise<void> {
  const only = process.env.RUN_ONLY ?? "";
  const selected = (files: string[]) => (only ? files.filter((f) => f.includes(only)) : files);
  const failures: string[] = [];
  let pass = 0;
  for (const file of selected(UNIT)) {
    const failure = await runFile(file);
    if (failure) failures.push(failure);
    else pass += 1;
  }
  if (!dbAvailable()) {
    console.log("SKIP integration tests (set DATABASE_URL or PGLITE_DATA_DIR to run them)");
  } else {
    const mode = await ensureTestDb();
    console.log(`integration backend: ${mode}`);
    for (const file of selected(INTEGRATION)) {
      const failure = await runFile(file);
      if (failure) failures.push(failure);
      else pass += 1;
    }
  }
  await closeTestDb();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
