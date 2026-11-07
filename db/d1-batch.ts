// Runs several SQL statements all-or-nothing on Cloudflare D1, through D1's own batch. Kept in its own file (no Cloudflare imports) so a unit test can run it against a stand-in binding.

import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

/** The part of a D1 database this needs. */
export type BatchBinding = {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
  batch(statements: unknown[]): Promise<unknown>;
};

/** D1 accepts at most a few hundred statements in one batch; longer lists go in consecutive batches of this many (each batch is all-or-nothing, the list as a whole is not). */
export const BATCH_SIZE = 90;

/**
 * Each statement is turned into its text and its values and prepared on the binding, then sent with `binding.batch`. (drizzle's `db.run(...)` result cannot be put in
 * drizzle's own batch: that fails with "Cannot read properties of undefined (reading 'bind')", which is what a 500 on creating an AI token was.)
 */
export async function batchOnD1(binding: BatchBinding, statements: SQL[]): Promise<void> {
  const dialect = new SQLiteSyncDialect();
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await binding.batch(
      statements.slice(i, i + BATCH_SIZE).map((statement) => {
        const query = dialect.sqlToQuery(statement);
        return binding.prepare(query.sql).bind(...(query.params as unknown[]));
      }),
    );
  }
}
