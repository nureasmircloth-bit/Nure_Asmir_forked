/** Applies the migrations in ./drizzle that the SQLite file at `file` has not seen yet; returns how many were applied. */
export function applyMigrations(file: string, options?: { reset?: boolean }): number;
