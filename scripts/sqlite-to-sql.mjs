// Turns the rows of a local SQLite file (the stand-in for D1) into .sql files that `wrangler d1 execute ... --file` can run, parents first:
//
//   node scripts/sqlite-to-sql.mjs .local-db/e2e.sqlite .local-db/import      # then: wrangler d1 execute DB --local|--remote --file .local-db/import/0001.sql ...
//   add  --only products,orders   to dump just some tables
//
// Used to put the demo shop (or the training lab's starting data, made by scripts/sandbox-setup.ts) into a real D1 database, and to rehearse an import
// on the local D1 emulator. Each file stays under about 700 KB, so D1 accepts it.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt >= 0 ? process.argv[onlyAt + 1].split(",") : null;
const [source, outDirArg] = args;
if (!source || !outDirArg) throw new Error("Usage: node scripts/sqlite-to-sql.mjs <file.sqlite> <out-folder> [--only a,b]");
const outDir = path.resolve(outDirArg);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const db = new Database(path.resolve(source), { readonly: true });
const tables = db
  .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\' and name not like '\\_%' escape '\\' and name <> 'd1_migrations' order by name")
  .all()
  .map((row) => row.name)
  .filter((name) => !only || only.includes(name));

const parents = new Map(tables.map((name) => [name, db.prepare(`select distinct "table" as parent from pragma_foreign_key_list('${name}')`).all().map((row) => row.parent).filter((p) => p !== name)]));
const ordered = [];
const placed = new Set();
const visit = (name, trail = new Set()) => {
  if (placed.has(name) || trail.has(name) || !parents.has(name)) return;
  trail.add(name);
  for (const parent of parents.get(name)) visit(parent, trail);
  placed.add(name);
  ordered.push(name);
};
tables.forEach((name) => visit(name));

const literal = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
};

let chunk = ["PRAGMA defer_foreign_keys = true;"];
let bytes = 0;
let fileNo = 0;
const flush = () => {
  if (chunk.length <= 1 && fileNo > 0) return;
  fileNo++;
  fs.writeFileSync(path.join(outDir, `${String(fileNo).padStart(4, "0")}.sql`), chunk.join("\n") + "\n");
  chunk = [];
  bytes = 0;
};
let rowsTotal = 0;
for (const name of ordered) {
  chunk.push(`DELETE FROM "${name}";`);
  const columns = db.prepare(`select name from pragma_table_info('${name}')`).all().map((row) => `"${row.name}"`).join(", ");
  for (const row of db.prepare(`select * from "${name}"`).iterate()) {
    const line = `INSERT INTO "${name}" (${columns}) VALUES (${Object.values(row).map(literal).join(", ")});`;
    chunk.push(line);
    bytes += line.length;
    rowsTotal++;
    if (bytes > 700_000) flush();
  }
}
flush();
console.log(`${rowsTotal} rows from ${ordered.length} tables written to ${fileNo} file(s) in ${outDir}`);
