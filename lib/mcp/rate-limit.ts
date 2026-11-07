// The cheap first line of defence for the AI connection: a request limit kept in the memory of the Worker that handles the request. It costs no database reads, so a flood of
// bad requests is stopped BEFORE anything is looked up. It is per Worker copy, so it is only a guard against floods; the exact per-token limit that holds everywhere is
// in lib/mcp/rate-limit-shared.ts.

const WINDOW_MS = 60_000;
/** Most requests from one address in a minute (before anything is looked up in the database). */
export const MAX_PER_ADDRESS = 120;
/** Most requests for one token in a minute. */
export const MAX_CALLS_PER_MINUTE = 60;
const buckets = new Map<string, number[]>();

/** Counts a request for `key` and says whether it is within `max` requests in the last minute. */
export function allowBurst(key: string, max: number, now = Date.now()): boolean {
  const recent = (buckets.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= max) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 500) for (const [other, list] of buckets) if (!list.some((at) => now - at < WINDOW_MS)) buckets.delete(other);
  return true;
}

/** The per-token check in memory (the same limit as the shared one, used where no database is wanted). */
export function allowCall(tokenId: string, now = Date.now()): boolean {
  return allowBurst(`token:${tokenId}`, MAX_CALLS_PER_MINUTE, now);
}
