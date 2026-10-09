// Builds and updates the PRACTICE tables: it runs the very same migrations as the real database (drizzle/*.sql), after pointing their
// "public" table references at the "practice" schema, and remembers which ones it has applied. Safe to run again.
//
//   DATABASE_URL=<the practice connection string> npx tsx scripts/practice-migrate.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

type Journal = { entries: Array<{ tag: string }> };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (use the PRACTICE connection string).");
  const sql = neon(url);

  const where = (await sql`select current_schema() as schema`) as Array<{ schema: string }>;
  if (where[0]?.schema !== "practice") throw new Error(`Refusing to continue: this connection looks at the "${where[0]?.schema}" tables, not the practice ones.`);

  await sql.query(`create table if not exists practice.__practice_migrations (tag text primary key, applied_at timestamptz not null default now())`);
  const done = new Set(((await sql`select tag from practice.__practice_migrations`) as Array<{ tag: string }>).map((row) => row.tag));
  const journal = JSON.parse(readFileSync(path.join("drizzle", "meta", "_journal.json"), "utf8")) as Journal;

  let applied = 0;
  for (const { tag } of journal.entries) {
    if (done.has(tag)) continue;
    const statements = readFileSync(path.join("drizzle", `${tag}.sql`), "utf8")
      .replaceAll('"public".', '"practice".')
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    // one migration = one all-or-nothing step, recorded in the same step
    await sql.transaction([...statements.map((statement) => sql.query(statement)), sql.query(`insert into practice.__practice_migrations (tag) values ('${tag}')`)]);
    console.log(`applied ${tag}`);
    applied += 1;
  }
  console.log(applied ? `Practice tables updated (${applied} migrations).` : "Practice tables are already up to date.");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
