// Creates the PRACTICE tables' home inside the existing database: a schema called "practice" and a database user, "practice_user",
// that can only see that schema (its search_path is "practice" and it has no rights on the real tables). Safe to run again.
//
//   DATABASE_URL=<the real database, as its owner> npx tsx scripts/practice-create.ts <file to write the practice connection string to>
//
// The practice connection string is written to the file (never printed), so it can be stored as the PRACTICE_DATABASE_URL secret.
// Pass --rotate to give the user a new password. Then run the migrations and the practice setup against that connection string:
//   DATABASE_URL=<practice string> DRIZZLE_MIGRATIONS_SCHEMA=practice npx drizzle-kit migrate
//   DATABASE_URL=<practice string> npx tsx scripts/sandbox-setup.ts
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const ROLE = "practice_user";
const SCHEMA = "practice";

async function main() {
  const url = process.env.DATABASE_URL;
  const out = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--"));
  if (!url || !out) throw new Error("Usage: DATABASE_URL=<owner connection string> npx tsx scripts/practice-create.ts <output file> [--rotate]");
  const sql = neon(url);

  const existing = (await sql`select 1 from pg_roles where rolname = ${ROLE}`) as unknown[];
  const rotate = process.argv.includes("--rotate");
  if (existing.length && !rotate) {
    console.log(`${ROLE} already exists. Nothing to do (use --rotate to set a new password).`);
    return;
  }
  const password = randomBytes(24).toString("hex");
  if (!existing.length) await sql.query(`create role ${ROLE} login password '${password}'`);
  else await sql.query(`alter role ${ROLE} password '${password}'`);
  await sql.query(`create schema if not exists ${SCHEMA}`);
  await sql.query(`grant all on schema ${SCHEMA} to ${ROLE}`);
  // The user may build things only inside its own schema, never create new schemas in the database (an older version of this script granted that).
  await sql.query(`do $$ begin execute format('revoke create on database %I from ${ROLE}', current_database()); end $$`);
  await sql.query(`alter role ${ROLE} set search_path = ${SCHEMA}`);
  // the practice user must never reach the real tables, even by accident
  await sql.query(`revoke all on all tables in schema public from ${ROLE}`);
  await sql.query(`revoke all on all sequences in schema public from ${ROLE}`);

  const practice = new URL(url);
  practice.username = ROLE;
  practice.password = password;
  writeFileSync(out, practice.toString(), { mode: 0o600 });
  console.log(`Created ${ROLE} and the "${SCHEMA}" schema. The connection string was written to ${out}.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
