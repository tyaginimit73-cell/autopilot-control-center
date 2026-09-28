/**
 * Test bootstrap. MUST be the first import in every test file: when
 * PGLITE_DATA_DIR is set it redirects `require("pg")` to the file-backed
 * PGlite adapter before any `@/db` module loads, so integration tests run
 * without a Postgres server.
 *
 * Modes:
 *  - PGLITE_DATA_DIR set  → PGlite file DB (wiped + migrated on every run)
 *  - DATABASE_URL set     → real Postgres (wiped + migrated ONLY with ALLOW_TEST_WIPE=1)
 *  - neither              → integration tests skip with exit 0
 */
import { createRequire, Module } from "node:module";

const require = createRequire(__filename);

// Snapshot before applying dummy defaults: unit tests import @/ modules (which
// require DATABASE_URL at load) but never connect; integration needs real config.
const explicitDb = process.env.DATABASE_URL ?? process.env.PGLITE_DATA_DIR;
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://test-only/unused";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-only-secret";

if (process.env.PGLITE_DATA_DIR) {
  const adapter = require("./pglite-adapter.cjs");
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function patchedLoad(request: unknown, ...rest: unknown[]) {
    if (request === "pg") return adapter;
    return (originalLoad as (...a: unknown[]) => unknown).call(this, request, ...rest);
  };
}

export function dbAvailable(): boolean {
  return Boolean(explicitDb);
}

type Queryable = { query: (text: string) => Promise<unknown> };

export async function ensureTestDb(): Promise<"pglite" | "postgres"> {
  const { pool } = await import("@/db");
  if (process.env.PGLITE_DATA_DIR) {
    await wipeAndMigrate(pool as unknown as Queryable);
    return "pglite";
  }
  if (process.env.DATABASE_URL) {
    if (process.env.ALLOW_TEST_WIPE !== "1") {
      throw new Error("Refusing to wipe DATABASE_URL without ALLOW_TEST_WIPE=1 — integration tests need a disposable database");
    }
    await wipeAndMigrate(pool as unknown as Queryable);
    return "postgres";
  }
  throw new Error("SKIP: set DATABASE_URL or PGLITE_DATA_DIR to run integration tests");
}

async function wipeAndMigrate(pool: Queryable): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.replace(/;\s*$/, "").trim())
    .filter(Boolean);
  for (const stmt of statements) await pool.query(stmt);
}

export async function closeTestDb(): Promise<void> {
  const { pool } = await import("@/db");
  await (pool as unknown as { end: () => Promise<void> }).end().catch(() => undefined);
}
