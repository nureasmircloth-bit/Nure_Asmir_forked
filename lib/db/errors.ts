/** True if the given error is a unique-constraint violation (a duplicate SKU, slug, email, key...). SQLite and D1 report it as
 * "UNIQUE constraint failed: table.column" (code SQLITE_CONSTRAINT_UNIQUE / SQLITE_CONSTRAINT_PRIMARYKEY); drizzle wraps the driver's error in
 * an outer "Failed query" Error and moves the original to `.cause`, so the message and code are checked on every error in that chain.
 * Use this to turn an expected conflict into a clean 409 response instead of an uncaught exception reaching the client as a raw 500. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const { code, message } = current as { code?: unknown; message?: unknown };
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") return true;
    if (typeof message === "string" && /UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
