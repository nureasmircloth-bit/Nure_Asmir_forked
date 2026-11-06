// A per-token request limit, so a runaway assistant cannot hammer the shop: this many calls in one minute. It is kept in the memory of the Worker that
// handles the request, which is plenty for one owner's assistants (and costs no database reads).

const WINDOW_MS = 60_000;
export const MAX_CALLS_PER_MINUTE = 60;
const calls = new Map<string, number[]>();

export function allowCall(tokenId: string, now = Date.now()): boolean {
  const recent = (calls.get(tokenId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_CALLS_PER_MINUTE) {
    calls.set(tokenId, recent);
    return false;
  }
  recent.push(now);
  calls.set(tokenId, recent);
  if (calls.size > 500) for (const [key, list] of calls) if (!list.some((at) => now - at < WINDOW_MS)) calls.delete(key);
  return true;
}
