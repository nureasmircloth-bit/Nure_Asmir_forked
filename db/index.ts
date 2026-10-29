import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle as drizzleD1, type DrizzleD1Database } from "drizzle-orm/d1";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";

/**
 * The database is Cloudflare D1 (SQLite). On Cloudflare each Worker gets it as the binding `DB`: the store and the admin share one D1
 * database, and the training lab has its own (see the wrangler*.jsonc files), so every screen of the admin works unchanged there.
 *
 * Tests, local development, scripts and the production build use a plain SQLite file instead (LOCAL_DB_PATH, created by
 * scripts/local-db.ts from the same migrations), so none of them ever touches the real data.
 *
 * `db` is a thin proxy: the connection is looked up on first use in the request being handled, never at import time, because a Worker
 * must not hold on to I/O objects from one request in another.
 */
export type Db = DrizzleD1Database<typeof schema> & {
  /** Runs a hand-written query and returns its rows (`{ rows }`, as the previous Postgres driver did). Works for select and for statements without rows. */
  execute<T = Record<string, unknown>>(query: SQL): Promise<{ rows: T[] }>;
};

let local: Db | null = null;
function localDb(path: string): Db {
  if (local) return local;
  // A hidden require: the Worker bundle must never try to include the native SQLite library.
  const req = eval("require") as NodeRequire;
  const Database = req("better-sqlite3") as new (file: string) => { pragma(sql: string): unknown };
  const { drizzle } = req("drizzle-orm/better-sqlite3") as { drizzle: (client: unknown, config: unknown) => unknown };
  const client = new Database(path) as unknown as { pragma(sql: string): unknown; prepare: (sql: string) => unknown };
  client.pragma("journal_mode = WAL");
  client.pragma("busy_timeout = 5000");
  client.pragma("foreign_keys = ON");
  if (process.env.D1_STRICT === "1") {
    // Cloudflare D1 refuses a statement with more than 100 bound values; a plain SQLite file does not. In strict mode (the test server) the same
    // limit is enforced here, so a query that would only fail on the real database fails in the tests instead.
    const prepare = client.prepare.bind(client) as (sql: string) => unknown;
    (client as unknown as { prepare: (sql: string) => unknown }).prepare = (statement: string) => {
      const bound = (statement.match(/\?/g) ?? []).length;
      if (bound > 100) throw new Error(`D1 allows at most 100 bound values per statement, this one has ${bound}: ${statement.slice(0, 120)}`);
      return prepare(statement);
    };
  }
  local = drizzle(client, { schema }) as unknown as Db;
  return local;
}

let http: Db | null = null;
/** Scripts run from a laptop or CI reach a real D1 database over Cloudflare's HTTP API (D1_HTTP_DATABASE_ID + CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN). */
function httpDb(): Db {
  if (http) return http;
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, D1_HTTP_DATABASE_ID: database } = process.env;
  if (!account || !token || !database) throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and D1_HTTP_DATABASE_ID are needed to reach D1 over HTTP.");
  const req = eval("require") as NodeRequire;
  const { drizzle } = req("drizzle-orm/sqlite-proxy") as { drizzle: (callback: unknown, config: unknown) => unknown };
  const callback = async (query: string, params: unknown[], method: string) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/raw`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql: query, params }),
    });
    const body = (await response.json()) as { success: boolean; errors?: Array<{ message: string }>; result?: Array<{ results: { rows: unknown[][] } }> };
    if (!body.success) throw new Error(`D1: ${body.errors?.map((e) => e.message).join("; ") ?? response.status}`);
    const rows = body.result?.[0]?.results?.rows ?? [];
    return { rows: method === "get" ? (rows[0] as unknown[]) : rows };
  };
  http = drizzle(callback, { schema }) as unknown as Db;
  return http;
}

function resolve(): Db {
  if (process.env.LOCAL_DB_PATH) return localDb(process.env.LOCAL_DB_PATH);
  if (process.env.D1_HTTP_DATABASE_ID) return httpDb();
  const env = getCloudflareContext().env as unknown as { DB?: D1Database };
  if (!env.DB) throw new Error("The D1 database binding `DB` is missing (see wrangler.jsonc).");
  return drizzleD1(env.DB, { schema }) as unknown as Db;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    if (property === "execute") {
      return async (query: SQL) => {
        const target = resolve() as unknown as { all(query: SQL): Promise<unknown[]> | unknown[]; run(query: SQL): unknown };
        let rows: Array<Record<string, unknown>>;
        try {
          rows = (await target.all(query)) as Array<Record<string, unknown>>;
        } catch (error) {
          // The local SQLite driver refuses `all()` for statements that return no rows (insert/update/delete); D1 does not.
          if (!/does not return data/i.test(String((error as Error)?.message))) throw error;
          await target.run(query);
          rows = [];
        }
        // JSON columns come back from a hand-written query as text: give the picture-width lists back as arrays.
        for (const row of rows) for (const key of Object.keys(row)) if (/(^|_)widths$/i.test(key) && typeof row[key] === "string") row[key] = JSON.parse(row[key] as string);
        return { rows };
      };
    }
    const target = resolve() as unknown as Record<string | symbol, unknown>;
    const value = target[property];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
});

/** The raw D1 binding (or null when running on a local SQLite file), for statements drizzle cannot express (batches, PRAGMA). */
export function d1Binding(): D1Database | null {
  if (process.env.LOCAL_DB_PATH || process.env.D1_HTTP_DATABASE_ID) return null;
  return (getCloudflareContext().env as unknown as { DB?: D1Database }).DB ?? null;
}

/**
 * Runs several statements all-or-nothing. D1 has no interactive transactions: its `batch` applies a list of statements in one go (all or none).
 * The local SQLite file used by tests and scripts wraps the same list in a real transaction.
 */
export async function runAtomically(statements: SQL[]): Promise<void> {
  if (!statements.length) return;
  const target = resolve() as unknown as {
    batch?: (queries: unknown[]) => Promise<unknown>;
    run: (query: SQL) => unknown;
    transaction?: (body: (tx: { run: (query: SQL) => unknown }) => void) => void;
  };
  if (process.env.LOCAL_DB_PATH && target.transaction) {
    target.transaction((tx) => {
      for (const statement of statements) tx.run(statement);
    });
    return;
  }
  // D1 accepts at most a few hundred statements per batch; larger lists are sent in consecutive batches of 90.
  if (!target.batch) {
    // Over the HTTP API there is no batch: the statements are sent one after another (scripts only).
    for (const statement of statements) await target.run(statement);
    return;
  }
  for (let i = 0; i < statements.length; i += 90) await target.batch(statements.slice(i, i + 90).map((statement) => target.run(statement)));
}

export { schema };
