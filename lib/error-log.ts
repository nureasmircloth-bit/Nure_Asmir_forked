import { sql } from "drizzle-orm";
import { db } from "@/db";
import { nowMs } from "@/db/sql-compat";
import { runInBackground } from "@/lib/background";
import { pktDay } from "@/lib/usage";

/**
 * The website's own error list for the developer page – no outside service needed. The same error on the same day is counted
 * (one row, a growing counter) so a failing page cannot flood the table. Never throws.
 */
const clip = (value: unknown, max: number) => String(value ?? "").slice(0, max);

/** Short, stable id for "the same error": name + message with numbers and ids blanked, plus where it happened. */
export function fingerprintOf(source: string, message: string, path: string): string {
  const shape = message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "#").replace(/\d+/g, "#").slice(0, 160);
  let hash = 5381;
  for (const ch of `${source}|${shape}|${path}`) hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

export async function recordError(input: { source: string; message: string; path?: string; stack?: string }): Promise<void> {
  try {
    const path = clip((input.path ?? "").split("?")[0], 200);
    const message = clip(input.message, 500);
    const source = clip(input.source, 60);
    const stack = clip(input.stack, 4000);
    const fingerprint = fingerprintOf(source, message, path);
    await db.execute(sql`
      insert into error_log (fingerprint, source, message, path, stack, day)
      values (${fingerprint}, ${source}, ${message}, ${path}, ${stack}, ${pktDay()})
      on conflict (fingerprint, day) do update set count = error_log.count + 1, last_seen_at = ${nowMs}`);
  } catch {
    // the error list must never become an error itself
  }
}

export function logError(input: { source: string; message: string; path?: string; stack?: string }): void {
  runInBackground(recordError(input), "error-log");
}
