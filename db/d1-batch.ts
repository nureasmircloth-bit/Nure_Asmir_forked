// Runs several SQL statements all-or-nothing on Cloudflare D1, through D1's own batch. Kept in its own file (no Cloudflare imports) so a unit test can run it against a stand-in binding.

import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

/** The part of a D1 database this needs. */
export type BatchBinding = {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
  batch(statements: unknown[]): Promise<unknown>;
};

/**
 * The most statements one all-or-nothing group may hold. A group is ONE D1 batch, because that is the only thing D1 applies all-or-nothing: splitting a long list into several
 * batches would leave the earlier ones saved when a later one fails (a half-restored practice shop). A longer list is refused before anything is sent.
 */
export const MAX_ATOMIC_STATEMENTS = 1000;

/**
 * Each statement is turned into its text and its values and prepared on the binding, then all are sent in one `binding.batch`. (drizzle's `db.run(...)` result cannot be put in
 * drizzle's own batch: that fails with "Cannot read properties of undefined (reading 'bind')", which is what a 500 on creating an AI token was.)
 */
export async function batchOnD1(binding: BatchBinding, statements: SQL[]): Promise<void> {
  if (!statements.length) return;
  if (statements.length > MAX_ATOMIC_STATEMENTS) {
    throw new Error(`${statements.length} statements cannot be applied all-or-nothing in one go (the most is ${MAX_ATOMIC_STATEMENTS}). Nothing was changed.`);
  }
  const dialect = new SQLiteSyncDialect();
  await binding.batch(
    statements.map((statement) => {
      const query = dialect.sqlToQuery(statement);
      return binding.prepare(query.sql).bind(...(query.params as unknown[]));
    }),
  );
}
