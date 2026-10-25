// Builds the disposable test database: a fresh SQLite file (the stand-in for Cloudflare D1) with the same schema, filled with the demo shop
// (scripts/seed.ts: owner login, settings, delivery zones, categories, products, banners). Pictures are uploaded to the test storage bucket
// named in .env.development.local. Run it once, and again whenever you want a clean start:  npm run e2e:db
import { spawnSync } from "node:child_process";
import path from "node:path";
import { applyMigrations } from "./local-db.mjs";

const file = path.resolve(process.env.E2E_LOCAL_DB ?? ".local-db/e2e.sqlite");
const applied = applyMigrations(file, { reset: true });
console.log(`${file}: ${applied} migration(s) applied; filling it with the demo shop...`);
const run = spawnSync(process.execPath, ["--env-file=.env.local", "--env-file=.env.development.local", "./node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"], {
  stdio: "inherit",
  env: { ...process.env, LOCAL_DB_PATH: file },
});
process.exit(run.status ?? 1);
