/**
 * Copies every table of the old Neon Postgres database into the new SQLite shape (Cloudflare D1). Read-only against Neon.
 *
 *   SOURCE_DATABASE_URL=postgres://... npx tsx scripts/neon-to-d1.ts --to-sqlite .local-db/e2e.sqlite     # a local SQLite file (tests, rehearsal)
 *   SOURCE_DATABASE_URL=postgres://... npx tsx scripts/neon-to-d1.ts --to-sql .local-db/import             # .sql files for `wrangler d1 execute --remote --file`
 *   add  --schema practice   to read the tables of the training lab's "practice" schema instead of "public"
 *   add  --only products,orders   to copy just some tables
 *
 * It converts what changes between the two databases: timestamps -> milliseconds, true/false -> 1/0, JSON -> text, dates -> YYYY-MM-DD.
 * Tables are written parents first, so no row ever points at a row that is not there yet. For every table it prints the row count and a
 * checksum (sha1 of the converted rows ordered by their first column) so the copy can be compared with what the target holds.
 */
import { neon } from "@neondatabase/serverless";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import * as schema from "../db/schema";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const sourceUrl = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("Set SOURCE_DATABASE_URL to the Neon connection string to copy from.");
const toSqlite = flag("--to-sqlite");
const toSql = flag("--to-sql");
if (!toSqlite && !toSql) throw new Error("Choose a target: --to-sqlite <file> or --to-sql <folder>.");
const pgSchema = flag("--schema") ?? "public";
const only = flag("--only")?.split(",").map((name) => name.trim()).filter(Boolean);

type Col = { name: string; kind: "time" | "bool" | "json" | "real" | "int" | "text" };
type Tbl = { name: string; cols: Col[]; parents: string[] };

const tables: Tbl[] = (Object.values(schema).filter((value) => is(value, SQLiteTable)) as SQLiteTable[]).map((table) => {
  const config = getTableConfig(table);
  return {
    name: config.name,
    cols: config.columns.map<Col>((column) => ({
      name: column.name,
      kind:
        column.columnType === "SQLiteTimestamp" ? "time"
        : column.columnType === "SQLiteBoolean" ? "bool"
        : column.columnType === "SQLiteTextJson" ? "json"
        : column.columnType === "SQLiteReal" ? "real"
        : column.columnType === "SQLiteInteger" ? "int"
        : "text",
    })),
    parents: config.foreignKeys.map((fk) => getTableConfig(fk.reference().foreignTable as SQLiteTable).name).filter((name) => name !== config.name),
  };
});

/** Parents before children. */
function ordered(list: Tbl[]): Tbl[] {
  const byName = new Map(list.map((t) => [t.name, t]));
  const out: Tbl[] = [];
  const placed = new Set<string>();
  const visit = (t: Tbl, trail: Set<string>) => {
    if (placed.has(t.name) || trail.has(t.name)) return;
    trail.add(t.name);
    for (const parent of t.parents) {
      const p = byName.get(parent);
      if (p) visit(p, trail);
    }
    placed.add(t.name);
    out.push(t);
  };
  for (const t of list) visit(t, new Set());
  return out;
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function convert(col: Col, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  switch (col.kind) {
    case "time": {
      const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value));
      return Number.isFinite(ms) ? ms : null;
    }
    case "bool":
      return value === true || value === "t" || value === 1 || value === "true" ? 1 : 0;
    case "json":
      return typeof value === "string" && /^[[{"]/.test(value) ? value : JSON.stringify(value);
    case "real":
    case "int":
      return Number(value);
    default:
      return value instanceof Date ? localDay(value) : String(value);
  }
}

const literal = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? (Number.isFinite(value) ? String(value) : "NULL") : `'${value.replaceAll("'", "''")}'`;

async function main() {
  const sql = neon(sourceUrl!);
  const wanted = ordered(tables.filter((t) => !only || only.includes(t.name)));
  let sqlite: Database.Database | null = null;
  let outDir = "";
  let chunk: string[] = [];
  let chunkBytes = 0;
  let fileNo = 0;
  const flush = () => {
    if (!chunk.length) return;
    fileNo++;
    fs.writeFileSync(path.join(outDir, `${String(fileNo).padStart(4, "0")}.sql`), chunk.join("\n") + "\n");
    chunk = [];
    chunkBytes = 0;
  };
  if (toSqlite) {
    sqlite = new Database(path.resolve(toSqlite));
    sqlite.pragma("foreign_keys = OFF");
  } else {
    outDir = path.resolve(toSql!);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    chunk.push("PRAGMA defer_foreign_keys = true;");
  }

  const report: Array<{ table: string; rows: number; sha1: string }> = [];
  for (const table of wanted) {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = (await sql.query(`select * from "${pgSchema}"."${table.name}"`)) as Array<Record<string, unknown>>;
    } catch (error) {
      console.warn(`skip ${table.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const present = table.cols.filter((col) => rows.length === 0 || col.name in rows[0]);
    const names = present.map((col) => `"${col.name}"`).join(", ");
    const converted = rows.map((row) => present.map((col) => convert(col, row[col.name])));
    const hash = createHash("sha1");
    [...converted].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).forEach((r) => hash.update(JSON.stringify(r)));
    report.push({ table: table.name, rows: rows.length, sha1: hash.digest("hex").slice(0, 12) });

    if (sqlite) {
      sqlite.exec(`delete from "${table.name}"`);
      const insert = sqlite.prepare(`insert into "${table.name}" (${names}) values (${present.map(() => "?").join(", ")})`);
      sqlite.transaction(() => converted.forEach((r) => insert.run(...r)))();
    } else {
      chunk.push(`DELETE FROM "${table.name}";`);
      for (const r of converted) {
        const line = `INSERT INTO "${table.name}" (${names}) VALUES (${r.map(literal).join(", ")});`;
        chunk.push(line);
        chunkBytes += line.length;
        if (chunkBytes > 700_000) flush();
      }
    }
  }
  flush();
  sqlite?.close();
  console.table(report);
  fs.writeFileSync(path.join(toSql ? outDir : path.dirname(path.resolve(toSqlite!)), "copy-report.json"), JSON.stringify(report, null, 2));
  console.log(`${report.reduce((sum, r) => sum + r.rows, 0)} rows in ${report.length} tables copied.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
