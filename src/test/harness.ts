/** Minimal assertion helpers for the Phase 1.5 regression suite (no test runner dep). */

export function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`CHECK FAILED: ${message}`);
}

export function eq<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`CHECK FAILED: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function includes(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`CHECK FAILED: ${message} — expected ${JSON.stringify(haystack)} to contain ${JSON.stringify(needle)}`);
  }
}

export function excludes(haystack: string, needle: string, message: string): void {
  if (haystack.includes(needle)) {
    throw new Error(`CHECK FAILED: ${message} — expected output NOT to contain ${JSON.stringify(needle)}`);
  }
}

export async function expectApiError(fn: () => Promise<unknown>, status: number, message: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const api = error as { status?: unknown; name?: unknown };
    if (api && api.name === "ApiError" && api.status === status) return;
    throw new Error(
      `CHECK FAILED: ${message} — expected ApiError ${status}, got ${(error as Error)?.name ?? typeof error}(${(error as { status?: unknown })?.status}) ${(error as Error)?.message ?? ""}`,
    );
  }
  throw new Error(`CHECK FAILED: ${message} — expected ApiError ${status}, but nothing was thrown`);
}
