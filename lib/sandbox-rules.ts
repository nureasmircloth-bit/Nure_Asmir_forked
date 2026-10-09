/**
 * The practice shop ("sandbox"): the very same admin screens, running on their own small database full of pretend data, so the owner
 * can learn by doing without any risk. The practice copy is a separate Worker (wrangler.sandbox.jsonc) that sets SANDBOX=1; everything
 * here is pure so the limits can be tested without a database.
 */

/** What one practice shop is allowed to use. Generous enough to learn every lesson, small enough to cost nothing. */
export const SANDBOX_LIMITS = {
  /** Page views and button presses in the admin per day (Pakistan time). Pictures, scripts and the sign-in page are not counted. */
  hitsPerDay: 1500,
  /** How much the practice tables may grow beyond their starting size, in bytes (1 MB). */
  storageBytes: 1024 * 1024,
  /** Most things of each kind that can exist at once. "Start again" puts everything back to the starting data. */
  rows: { products: 25, orders: 60, categories: 8, coupons: 10, flashSales: 5, faqs: 15, collections: 6, locations: 3 },
} as const;

/** Today's allowance. Normally 1500; the SANDBOX_HITS_PER_DAY variable on the practice Worker changes it without a code change. */
export const dailyHitLimit = (env: Record<string, string | undefined> = process.env): number => {
  const set = Number(env.SANDBOX_HITS_PER_DAY);
  return Number.isFinite(set) && set > 0 ? Math.floor(set) : SANDBOX_LIMITS.hitsPerDay;
};

export type SandboxThing = keyof typeof SANDBOX_LIMITS.rows;

export const SANDBOX_THING_LABEL: Record<SandboxThing, string> = {
  products: "products",
  orders: "orders",
  categories: "categories",
  coupons: "discount codes",
  flashSales: "flash sales",
  faqs: "questions",
  collections: "collections",
  locations: "shop locations",
};

export const isSandboxEnv = (env: Record<string, string | undefined> = process.env): boolean => env.SANDBOX === "1";

/**
 * Does this request use up one of today's practice hits? Counts what a person does: opening an admin page, pressing a button that
 * talks to the server. Does not count browser prefetching, scripts, pictures, signing in/out, or the "Start again" button itself.
 */
export function hitCountsAgainstLimit(pathname: string, method: string, headers: { get(name: string): string | null }): boolean {
  const isPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isApi = pathname.startsWith("/api/admin/");
  if (!isPage && !isApi) return false;
  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/login") || pathname.startsWith("/api/admin/logout")) return false;
  if (pathname.startsWith("/api/admin/sandbox/")) return false;
  if (headers.get("next-router-prefetch") || headers.get("purpose") === "prefetch") return false;
  if (isApi) return true;
  return method === "GET" || method === "POST"; // pages (including client-side navigations) and server actions
}

export type HitState = { used: number; left: number; limit: number; blocked: boolean };

export function hitState(used: number, limit: number = dailyHitLimit()): HitState {
  return { used, limit, left: Math.max(0, limit - used), blocked: used > limit };
}

/** The sentence shown when a practice shop is full ("You can have up to 25 products here …"), or null while there is room. */
export function roomMessage(thing: SandboxThing, current: number): string | null {
  const max = SANDBOX_LIMITS.rows[thing];
  return current >= max ? `The practice shop is full: it can hold up to ${max} ${SANDBOX_THING_LABEL[thing]}. Press “Start again” at the top to clear your practice, or delete some first.` : null;
}

export const LIMIT_REACHED_MESSAGE = "You have used all of today's practice. It starts fresh tomorrow. Your real shop is not affected.";
