import { sql } from "drizzle-orm";
import { db, practiceDb } from "@/db";
import { isPracticeRequest } from "./practice-context";
import { hitState, roomMessage, SANDBOX_LIMITS, type HitState, type SandboxThing } from "./sandbox-rules";

export { SANDBOX_LIMITS, SANDBOX_THING_LABEL, LIMIT_REACHED_MESSAGE } from "./sandbox-rules";
export type { SandboxThing } from "./sandbox-rules";

/** True while the request being handled is a practice request (see lib/practice-context.ts). */
export const isSandbox = (): boolean => isPracticeRequest();

/** Is the practice shop set up on this server at all? (It needs its own database user, PRACTICE_DATABASE_URL.) */
export const practiceAvailable = (): boolean => Boolean(process.env.PRACTICE_DATABASE_URL);

const pakistanDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });

type Rows<T> = { rows: T[] };

// Everything below that is about setting practice up, counting or resetting uses the practice tables directly, whatever the current request is.
const practice = () => practiceDb();

export async function sandboxHits(): Promise<HitState> {
  try {
    const result = (await practice().execute(sql`select hits from sandbox_usage where day = ${pakistanDay()}`)) as unknown as Rows<{ hits: number }>;
    return hitState(Number(result.rows[0]?.hits ?? 0));
  } catch {
    return hitState(0);
  }
}

const TABLE_FOR: Record<SandboxThing, string> = {
  products: "products",
  orders: "orders",
  categories: "categories",
  coupons: "discount_codes",
  flashSales: "flash_sales",
  faqs: "faqs",
  collections: "collections",
  locations: "store_locations",
};

/** How much room the practice tables take on disk (data and indexes). */
export async function practiceBytes(): Promise<number> {
  const result = (await practice().execute(
    sql`select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as bytes from pg_class c where c.relnamespace = current_schema()::regnamespace and c.relkind = 'r'`,
  )) as unknown as Rows<{ bytes: string | number }>;
  return Number(result.rows[0]?.bytes ?? 0);
}

const START_KEY = "__start_bytes";

async function startBytes(): Promise<number> {
  const result = (await practice().execute(sql`select rows from sandbox_baseline where table_name = ${START_KEY}`)) as unknown as Rows<{ rows: number[] }>;
  return Number(result.rows[0]?.rows?.[0] ?? 0);
}

/**
 * Call before creating something on the practice shop. Returns the sentence to show when it is full (too many of that thing, or the
 * practice tables have grown by more than their small storage allowance), or null when there is room. Always null on the real shop.
 */
export async function sandboxRoomMessage(thing: SandboxThing): Promise<string | null> {
  if (!isSandbox()) return null;
  try {
    const result = (await db.execute(sql.raw(`select count(*)::int as n from "${TABLE_FOR[thing]}"`))) as unknown as Rows<{ n: number }>;
    const crowded = roomMessage(thing, Number(result.rows[0]?.n ?? 0));
    if (crowded) return crowded;
    const grown = (await practiceBytes()) - (await startBytes());
    return grown > SANDBOX_LIMITS.storageBytes ? "The practice shop's small storage (1 MB) is full. Press “Start again” at the top to clear your practice, or delete some things first." : null;
  } catch {
    return null;
  }
}

/* ---------------------------- the starting data ---------------------------- */

// Tables that are never copied or wiped: who may sign in, the day counters, and the copy itself.
const KEEP = new Set(["admin_owners", "admin_sessions", "admin_push_devices", "login_attempts", "sandbox_usage", "sandbox_baseline", "api_usage", "admin_audit_log", "error_log"]);

async function dataTables(): Promise<string[]> {
  const result = (await practice().execute(sql`select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name`)) as unknown as Rows<{ table_name: string }>;
  return result.rows.map((row) => row.table_name).filter((name) => !KEEP.has(name) && !name.startsWith("__"));
}

/** Tables ordered so that a table always comes after the tables it points to (so rows can be put back without breaking a link). */
async function insertOrder(tables: string[]): Promise<string[]> {
  const result = (await practice().execute(
    sql`select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent from pg_constraint c where c.contype = 'f' and c.connamespace = current_schema()::regnamespace`,
  )) as unknown as Rows<{ child: string; parent: string }>;
  const wanted = new Set(tables);
  const needs = new Map<string, Set<string>>(tables.map((table) => [table, new Set<string>()]));
  for (const { child, parent } of result.rows) {
    const c = child.replaceAll('"', "").replace(/^practice\./, "");
    const p = parent.replaceAll('"', "").replace(/^practice\./, "");
    if (c !== p && wanted.has(c) && wanted.has(p)) needs.get(c)?.add(p);
  }
  const ordered: string[] = [];
  const placed = new Set<string>();
  while (ordered.length < tables.length) {
    const next = tables.filter((table) => !placed.has(table) && [...(needs.get(table) ?? [])].every((parent) => placed.has(parent)));
    if (!next.length) {
      ordered.push(...tables.filter((table) => !placed.has(table))); // a circular link: the rest in any order
      break;
    }
    for (const table of next) {
      placed.add(table);
      ordered.push(table);
    }
  }
  return ordered;
}

/** Remembers how every practice table looks right now as "the starting data". Used once when the practice tables are first filled. */
export async function captureBaseline(): Promise<number> {
  const tables = await dataTables();
  await practice().execute(sql`delete from sandbox_baseline`);
  for (const table of tables) {
    await practice().execute(sql.raw(`insert into sandbox_baseline (table_name, rows) select '${table}', coalesce(jsonb_agg(t), '[]'::jsonb) from "${table}" t`));
  }
  const bytes = await practiceBytes();
  await practice().execute(sql`insert into sandbox_baseline (table_name, rows) values (${START_KEY}, ${JSON.stringify([bytes])}::jsonb)`);
  return tables.length;
}

export async function hasBaseline(): Promise<boolean> {
  try {
    const result = (await practice().execute(sql`select 1 as one from sandbox_baseline where table_name <> ${START_KEY} limit 1`)) as unknown as Rows<{ one: number }>;
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/** Puts every practice table back to the starting data in one all-or-nothing step. Sign-ins and today's counters are left alone. */
export async function resetToBaseline(): Promise<{ tables: number }> {
  const saved = (await practice().execute(sql`select table_name, rows from sandbox_baseline where table_name <> ${START_KEY}`)) as unknown as Rows<{ table_name: string; rows: unknown[] }>;
  if (!saved.rows.length) throw new Error("There is no starting data saved yet.");
  const byName = new Map(saved.rows.map((row) => [row.table_name, row.rows]));
  const existing = new Set(await dataTables());
  const tables = await insertOrder([...byName.keys()].filter((name) => existing.has(name)));
  const wipe = sql.raw(`truncate table ${tables.map((table) => `"${table}"`).join(", ")} restart identity cascade`);
  const refill = tables.map((table) => sql`insert into ${sql.raw(`"${table}"`)} select * from jsonb_populate_recordset(null::${sql.raw(`"${table}"`)}, ${JSON.stringify(byName.get(table) ?? [])}::jsonb)`);
  const handle = practice();
  await handle.batch([handle.execute(wipe), ...refill.map((statement) => handle.execute(statement))] as unknown as Parameters<typeof handle.batch>[0]);
  return { tables: tables.length };
}
