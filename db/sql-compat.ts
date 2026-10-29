import { sql, type SQL } from "drizzle-orm";

/**
 * Small helpers for the few places that write SQL by hand. The database is Cloudflare D1 (SQLite): a point in time is whole milliseconds
 * since 1970, a true/false is 1/0 and JSON is text, so what Postgres did with `now()`, `interval`, `greatest()`, `regexp_replace()`, `@>`
 * and `::int` is spelled once here instead of in every query.
 */

/** The current time as a column default / in a query (milliseconds since 1970). */
export const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/** A random UUID (version 4) made by SQLite itself, so hand-written INSERTs that leave the id out still get one. */
export const uuidSql = sql`(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))))`;

/** The moment `days` days ago, as milliseconds (for `created_at < ...`). */
export const daysAgoMs = (days: number): number => Date.now() - days * 86_400_000;

/** The digits of a stored phone number: customers type 0300..., +92 300... or 92300-...; reports and searches compare digits only. */
export const phoneDigits = (column: SQL | { getSQL?: () => SQL } | unknown): SQL =>
  sql`replace(replace(replace(replace(replace(replace(${column}, ' ', ''), '+', ''), '-', ''), '(', ''), ')', ''), '.', '')`;

/** True when the JSON array stored in `column` contains the text `value` (what Postgres wrote as `column @> '["value"]'`). */
export const jsonArrayHas = (column: unknown, value: string): SQL => sql`exists (select 1 from json_each(${column}) where json_each.value = ${value})`;

/** The larger of two numbers inside a query (Postgres `greatest(a, b)`); SQLite's scalar `max` takes several values. */
export const greatest = (...values: unknown[]): SQL => sql`max(${sql.join(values.map((value) => sql`${value}`), sql`, `)})`;

/** D1 allows at most 100 bound values in one statement; keep lists of ids/skus to this many per query. */
export const D1_MAX_PARAMS = 90;

/** Splits a long list into pieces that fit in one D1 statement. */
export function chunked<T>(items: readonly T[], size = D1_MAX_PARAMS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `column LIKE pattern` where a backslash in the pattern escapes % and _ (SQLite has no default escape character). Case-insensitive for letters a-z. */
export const likeEsc = (column: unknown, pattern: string): SQL => sql`${column} like ${pattern} escape '\\'`;

/** Runs a lookup for every piece of a long list (each piece fits one D1 statement) and joins the answers. */
export async function inChunks<T, R>(list: readonly T[], run: (part: T[]) => PromiseLike<R[]>, size = D1_MAX_PARAMS): Promise<R[]> {
  const out: R[] = [];
  for (const part of chunked(list, size)) out.push(...(await run(part)));
  return out;
}
