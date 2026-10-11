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

/**
 * Stops guessing of order numbers + phone numbers (and coupon codes): true when this visitor has already had too many lookups that found
 * nothing in the last 15 minutes. Kept in the same table as sign-in attempts (the bucket name is stored where the e-mail would be).
 */
export async function lookupBlocked(bucket: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, bucket), eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
  return Number(row?.count ?? 0) >= MAX_LOOKUP_MISSES;
}

/** Remembers one lookup that found nothing. Never throws: a failing counter must not break the page. */
export async function noteLookupMiss(bucket: string, ip: string): Promise<void> {
  await recordLoginAttempt(bucket, ip, false).catch(() => undefined);
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
