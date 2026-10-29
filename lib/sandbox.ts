import { sql } from "drizzle-orm";
import { db, runAtomically } from "@/db";
import { isPracticeRequest } from "./practice-context";
import { hitState, roomMessage, SANDBOX_LIMITS, type HitState, type SandboxThing } from "./sandbox-rules";

export { SANDBOX_LIMITS, SANDBOX_THING_LABEL, LIMIT_REACHED_MESSAGE } from "./sandbox-rules";
export type { SandboxThing } from "./sandbox-rules";

/** True while the request being handled is a practice request (see lib/practice-context.ts). */
export const isSandbox = (): boolean => isPracticeRequest();

/** Is the practice shop set up on this server at all? Only the training Worker (SANDBOX=1) has it: that Worker's database IS the practice shop. */
export const practiceAvailable = (): boolean => process.env.SANDBOX === "1";

/** Returns the current calendar date in Pakistan time for daily practice usage counters. */
const pakistanDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });

type Rows<T> = { rows: T[] };

// The training Worker has its own D1 database (binding DB), so the practice tables are simply `db` there.
const practice = () => db;

/** Reads today's practice usage, falling back to zero used hits when the query fails. */
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
  try {
    const result = (await practice().execute(
      sql`select (select page_count from pragma_page_count) * (select page_size from pragma_page_size) as bytes`,
    )) as unknown as Rows<{ bytes: string | number }>;
    return Number(result.rows[0]?.bytes ?? 0);
  } catch {
    return 0; // some D1 connections do not allow the PRAGMA functions: the size limit then simply is not measured
  }
}

const START_KEY = "__start_bytes";

/** Reads the saved starting size of the practice tables, defaulting to zero if no size was captured. */
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
    const result = (await db.execute(sql.raw(`select count(*) as n from "${TABLE_FOR[thing]}"`))) as unknown as Rows<{ n: number }>;
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

/** Lists practice data tables eligible for baseline capture, excluding access, usage and internal tables. */
async function dataTables(): Promise<string[]> {
  const result = (await practice().execute(sql`select name as table_name from sqlite_master where type = 'table' and name not like 'sqlite!_%' escape '!' and name not like '!_cf!_%' escape '!' and name <> 'd1_migrations' and name not like '!_%' escape '!' order by name`)) as unknown as Rows<{ table_name: string }>;
  return result.rows.map((row) => row.table_name).filter((name) => !KEEP.has(name) && !name.startsWith("__"));
}

/** Tables ordered so that a table always comes after the tables it points to (so rows can be put back without breaking a link). */
async function insertOrder(tables: string[]): Promise<string[]> {
  const result = (await practice().execute(
    sql`select m.name as child, f."table" as parent from sqlite_master m, pragma_foreign_key_list(m.name) f where m.type = 'table'`,
  )) as unknown as Rows<{ child: string; parent: string }>;
  const wanted = new Set(tables);
  const needs = new Map<string, Set<string>>(tables.map((table) => [table, new Set<string>()]));
  for (const { child, parent } of result.rows) {
    const c = child;
    const p = parent;
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
    const copy = await practice().execute(sql.raw(`select * from "${table}"`));
    await practice().execute(sql`insert into sandbox_baseline (table_name, rows) values (${table}, ${JSON.stringify(copy.rows)})`);
  }
  const bytes = await practiceBytes();
  await practice().execute(sql`insert into sandbox_baseline (table_name, rows) values (${START_KEY}, ${JSON.stringify([bytes])})`);
  return tables.length;
}

/** Reports whether any practice table baseline exists, returning false if the lookup fails. */
export async function hasBaseline(): Promise<boolean> {
  try {
    const result = (await practice().execute(sql`select 1 as one from sandbox_baseline where table_name <> ${START_KEY} limit 1`)) as unknown as Rows<{ one: number }>;
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/** One saved cell, ready to be bound: picture-width lists were saved as arrays, but the column holds them as JSON text. */
const cell = (value: unknown): string | number | null => (value !== null && typeof value === "object" ? JSON.stringify(value) : (value as string | number | null));

/** Puts every practice table back to the starting data in one all-or-nothing step. Sign-ins and today's counters are left alone. */
export async function resetToBaseline(): Promise<{ tables: number }> {
  const saved = (await practice().execute(sql`select table_name, rows from sandbox_baseline where table_name <> ${START_KEY}`)) as unknown as Rows<{ table_name: string; rows: unknown }>;
  if (!saved.rows.length) throw new Error("There is no starting data saved yet.");
  const byName = new Map(saved.rows.map((row) => [row.table_name, row.rows]));
  const existing = new Set(await dataTables());
  const tables = await insertOrder([...byName.keys()].filter((name) => existing.has(name)));
  const parsed = (value: unknown): Array<Record<string, unknown>> => (typeof value === "string" ? (JSON.parse(value) as Array<Record<string, unknown>>) : ((value ?? []) as Array<Record<string, unknown>>));
  // Wipe children before parents, then refill parents before children: one all-or-nothing batch.
  const statements = [
    ...[...tables].reverse().map((table) => sql.raw(`delete from "${table}"`)),
    ...tables.flatMap((table) =>
      parsed(byName.get(table)).map((row) => {
        const columns = Object.keys(row);
        return sql`insert into ${sql.raw(`"${table}"`)} (${sql.raw(columns.map((column) => `"${column}"`).join(", "))}) values (${sql.join(columns.map((column) => sql`${cell(row[column])}`), sql`, `)})`;
      }),
    ),
  ];
  await runAtomically(statements);
  return { tables: tables.length };
}
