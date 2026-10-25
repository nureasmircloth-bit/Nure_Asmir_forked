// Creates / updates the local SQLite file that stands in for Cloudflare D1 in tests, scripts and the production build:
//
//   node scripts/local-db.mjs [path]            apply any migration in ./drizzle that the file has not seen yet
//   node scripts/local-db.mjs [path] --reset    delete the file first (an empty, fresh database)
//
// The path defaults to LOCAL_DB_PATH, then .local-db/dev.sqlite. The same ./drizzle/*.sql files are what `wrangler d1 migrations apply`
// runs on the real databases, so the schema is identical.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function applyMigrations(file, { reset = false } = {}) {
  if (reset) for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("create table if not exists __local_migrations (name text primary key, applied_at integer not null)");
  const done = new Set(db.prepare("select name from __local_migrations").all().map((row) => row.name));
  const dir = path.join(process.cwd(), "drizzle");
  const files = fs.readdirSync(dir).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  let applied = 0;
  for (const name of files) {
    if (done.has(name)) continue;
    const statements = fs.readFileSync(path.join(dir, name), "utf8").split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
    db.transaction(() => {
      for (const statement of statements) db.exec(statement);
      db.prepare("insert into __local_migrations (name, applied_at) values (?, ?)").run(name, Date.now());
    })();
    applied++;
  }
  db.close();
  return applied;
}

if (process.argv[1]?.endsWith("local-db.mjs")) {
  const args = process.argv.slice(2);
  const file = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? process.env.LOCAL_DB_PATH ?? ".local-db/dev.sqlite");
  const applied = applyMigrations(file, { reset: args.includes("--reset") });
  console.log(`${file}: ${applied} migration(s) applied`);
}
