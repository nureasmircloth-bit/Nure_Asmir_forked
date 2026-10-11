import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

export async function recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
  await db.insert(loginAttempts).values({ email: email.toLowerCase(), ip, success });
}

export async function isLoginRateLimited(email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failed = await db
    .select({ count: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email.toLowerCase()),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, since),
      ),
    );
  const byEmail = Number(failed[0]?.count ?? 0) >= MAX_ATTEMPTS;

  const failedByIp = await db
    .select({ count: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
  const byIp = Number(failedByIp[0]?.count ?? 0) >= MAX_ATTEMPTS * 3;

  return byEmail || byIp;
}

/** The visitor's address as Cloudflare saw it (it overwrites CF-Connecting-IP, so a visitor cannot choose it), else the forwarded one. */
export function requestIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Wrong guesses allowed per visitor address per 15 minutes before lookups of orders and coupons are paused. */
export const MAX_LOOKUP_MISSES = 25;

export type LookupGuard = { allowed: boolean; /** Call when the lookup FOUND something: the reserved place is given back, so only wrong guesses use up the allowance. */ release: () => Promise<void> };

/**
 * Stops guessing of order numbers + phone numbers (and coupon codes). It reserves a place first (a row is written BEFORE counting), so many
 * requests arriving at the same moment cannot all slip through: each one counts its own row too, and only 25 can ever be inside the limit
 * for one visitor address in 15 minutes. Wrong guesses keep their row; a lookup that finds something calls release(). Kept in the same
 * table as sign-in attempts (the bucket name is stored where the e-mail would be). A failing counter never blocks a shopper.
 */
export async function reserveLookup(bucket: string, ip: string): Promise<LookupGuard> {
  try {
    const [row] = await db.insert(loginAttempts).values({ email: bucket, ip, success: false }).returning({ id: loginAttempts.id });
    const since = new Date(Date.now() - WINDOW_MS);
    const [counted] = await db
      .select({ count: sql<number>`count(*)` })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.email, bucket), eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
    return {
      allowed: Number(counted?.count ?? 0) <= MAX_LOOKUP_MISSES,
      release: async () => {
        if (row) await db.delete(loginAttempts).where(eq(loginAttempts.id, row.id)).catch(() => undefined);
      },
    };
  } catch {
    return { allowed: true, release: async () => undefined };
  }
}

const checkoutAttempts = new Map<string, number[]>();
const CHECKOUT_WINDOW_MS = 60 * 1000;
const CHECKOUT_MAX = 8;

/** In-memory best-effort limiter for the checkout endpoint (per-Worker-isolate; the DB-backed order
 * idempotency key is the real duplicate-order guard — this only throttles abusive request bursts). */
export function isCheckoutRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (checkoutAttempts.get(ip) ?? []).filter((t) => now - t < CHECKOUT_WINDOW_MS);
  timestamps.push(now);
  checkoutAttempts.set(ip, timestamps);
  return timestamps.length > CHECKOUT_MAX;
}
