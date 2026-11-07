// The exact per-token limit: one atomic database upsert per request counts the calls of the current minute, so no number of Worker copies can let a token through more
// than MAX_CALLS_PER_MINUTE times a minute. Old minutes are swept away now and then.

import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { mcpRateLimits } from "@/db/schema";
import { MAX_CALLS_PER_MINUTE } from "./rate-limit";

/** Counts this call for the token in the current minute; false when the token has already used its calls for the minute. */
export async function allowSharedCall(tokenId: string, now = Date.now()): Promise<boolean> {
  const minute = Math.floor(now / 60_000);
  const rows = await db.all<{ calls: number }>(
    sql`insert into mcp_rate_limits (token_id, minute, calls) values (${tokenId}, ${minute}, 1) on conflict (token_id, minute) do update set calls = calls + 1 returning calls`,
  );
  // About one request in fifty also deletes the minutes that are over, so the table stays tiny.
  if (Math.random() < 0.02) await db.delete(mcpRateLimits).where(lt(mcpRateLimits.minute, minute - 10)).catch(() => undefined);
  return Number(rows[0]?.calls ?? 1) <= MAX_CALLS_PER_MINUTE;
}
