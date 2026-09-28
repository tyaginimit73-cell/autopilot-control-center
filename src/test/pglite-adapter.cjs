// TEST ONLY: `pg` API backed by PGlite (real Postgres semantics, file based).
// Loaded through the Module._load hook in setup.ts when PGLITE_DATA_DIR is set,
// so the suite can run without a Postgres server. Requires @electric-sql/pglite
// to be installed (`npm i --no-save @electric-sql/pglite`); it is deliberately
// NOT a dependency of the shipped app.
// Satisfies drizzle-orm/node-postgres usage:
//   new Pool({connectionString}), pool.query(config, params), pool.connect(),
//   client.query/release, pg.Pool (instanceof), pg.types builtins/getTypeParser.
const DATA_DIR = process.env.PGLITE_DATA_DIR || "/tmp/pgdata-test";

let PgliteCtor = null;
let pgcryptoExt = null;
function loadPglite() {
  if (!PgliteCtor) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      PgliteCtor = require("@electric-sql/pglite").PGlite;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      pgcryptoExt = require("@electric-sql/pglite/contrib/pgcrypto").pgcrypto;
    } catch {
      throw new Error(
        "PGlite test run needs @electric-sql/pglite: run `npm i --no-save @electric-sql/pglite` " +
          "(test-only, never committed) or set DATABASE_URL to a real Postgres instead.",
      );
    }
  }
}

let instance = null;
let ready = null;
function db() {
  if (!instance) {
    loadPglite();
    instance = new PgliteCtor(DATA_DIR, { extensions: { pgcrypto: pgcryptoExt } });
    ready = instance.waitReady.then(() => instance);
  }
  return ready;
}

// OIDs whose values drizzle expects as raw text (it installs identity parsers).
const TEXT_OIDS = new Set([1082, 1114, 1184, 1186, 1083, 1266, 1182, 1115, 1185, 1187, 1270, 1231]);

function toText(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(toText);
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : String(value);
}

function coerceParams(params) {
  if (!Array.isArray(params)) return params;
  return params.map((p) => {
    if (p === null || p === undefined) return p;
    if (p instanceof Date) return p;
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(p)) return p;
    if (typeof p === "object") return JSON.stringify(p);
    return p;
  });
}

async function runQuery(config, values) {
  const database = await db();
  const text = typeof config === "string" ? config : config.text;
  const rowMode = typeof config === "object" && config.rowMode === "array" ? "array" : "object";
  const params = coerceParams(typeof config === "object" && Array.isArray(values) ? values : Array.isArray(config) ? [] : values);
  const res = await database.query(text, params || [], { rowMode });
  const oids = (res.fields || []).map((f) => f.dataTypeID);
  const convert = (row, i) => (TEXT_OIDS.has(oids[i]) ? toText(row) : row);
  const rows = rowMode === "array" ? res.rows.map((r) => r.map(convert)) : res.rows;
  // object rows: convert per-column by field order
  if (rowMode === "object" && res.fields) {
    for (const row of rows) {
      for (const f of res.fields) {
        if (TEXT_OIDS.has(f.dataTypeID) && row[f.name] !== null && row[f.name] !== undefined) {
          row[f.name] = toText(row[f.name]);
        }
      }
    }
  }
  return { command: res.command, rowCount: res.affectedRows ?? rows.length, rows, fields: res.fields || [] };
}

class Client {
  constructor() {
    this.released = false;
  }
  async connect() {
    await db();
    return this;
  }
  query(config, values) {
    return runQuery(config, values);
  }
  release() {
    this.released = true;
  }
  async end() {}
  on() {
    return this;
  }
}

class Pool {
  constructor(opts) {
    this.options = opts || {};
  }
  query(config, values) {
    return runQuery(config, values);
  }
  async connect() {
    const c = new Client();
    await c.connect();
    return c;
  }
  async end() {}
  on() {
    return this;
  }
}

class Query {}
class Result {}

const types = {
  builtins: {
    BOOL: 16,
    BYTEA: 17,
    INT8: 20,
    INT2: 21,
    INT4: 23,
    TEXT: 25,
    OID: 26,
    FLOAT4: 700,
    FLOAT8: 701,
    NUMERIC: 1700,
    DATE: 1082,
    TIME: 1083,
    TIMESTAMP: 1114,
    TIMESTAMPTZ: 1184,
    INTERVAL: 1186,
    JSON: 114,
    JSONB: 3802,
    UUID: 2950,
    VARCHAR: 1043,
  },
  getTypeParser: () => (v) => v,
  setTypeParser: () => {},
};

exports.Pool = Pool;
exports.Client = Client;
exports.Query = Query;
exports.Result = Result;
exports.types = types;
exports.default = { Pool, Client, Query, Result, types };
