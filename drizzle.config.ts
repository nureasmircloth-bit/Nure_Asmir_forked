import { defineConfig } from "drizzle-kit";

// Cloudflare D1 (SQLite). `drizzle-kit generate` only reads db/schema.ts and needs no connection; the migrations in ./drizzle are applied
// with `wrangler d1 migrations apply` (the real databases) or scripts/local-db.ts (the SQLite file used by tests and local development).
// The earlier Postgres migrations live in ./drizzle-pg-archive.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
