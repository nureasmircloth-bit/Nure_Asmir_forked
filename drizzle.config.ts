import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required — copy .env.example to .env.local and set your Neon connection string.");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  // The practice tables keep their own list of applied migrations inside their own schema (see scripts/practice-create.ts).
  ...(process.env.DRIZZLE_MIGRATIONS_SCHEMA ? { migrations: { schema: process.env.DRIZZLE_MIGRATIONS_SCHEMA, table: "__drizzle_migrations" } } : {}),
});
