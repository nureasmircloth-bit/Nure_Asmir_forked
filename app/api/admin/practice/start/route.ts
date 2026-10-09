import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, practiceDb } from "@/db";
import { adminOwners, adminSessions } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { hashToken, SESSION_COOKIE } from "@/lib/auth/session";
import { makePracticeCookie, PRACTICE_COOKIE, PRACTICE_MINUTES } from "@/lib/practice-cookie";
import { hasBaseline, practiceAvailable, resetToBaseline } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

/**
 * Starts a practice session for the signed-in owner: puts the practice tables back to their starting data, lets the owner's own
 * sign-in work there too (so there is no second password), and hands the browser a signed cookie that switches it to the practice
 * tables for two hours. Nothing in the real shop is read or changed except the owner's own sign-in being copied across.
 */
export async function POST() {
  if (!practiceAvailable()) return Response.json({ error: "The practice shop is not set up yet." }, { status: 404 });
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "owner") return Response.json({ error: "Only the owner can open the practice shop." }, { status: 403 });
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "The practice shop needs the shop's secret key to be set." }, { status: 500 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ error: "Please sign in again." }, { status: 401 });

  try {
    if (!(await hasBaseline())) return Response.json({ error: "The practice data has not been set up yet. Please ask your developer." }, { status: 503 });
    await resetToBaseline();

    // copy the owner's sign-in across (a request that is already practising reads the practice tables, where it already exists)
    const practice = practiceDb();
    const [owner] = await db.select().from(adminOwners).where(eq(adminOwners.email, admin.email)).limit(1);
    if (owner) await practice.insert(adminOwners).values(owner).onConflictDoNothing();
    await practice
      .insert(adminSessions)
      .values({ tokenHash: hashToken(token), adminEmail: admin.email, expiresAt: new Date(Date.now() + PRACTICE_MINUTES * 60_000) })
      .onConflictDoNothing();
  } catch (error) {
    console.error("practice start failed", error);
    return Response.json({ error: "The practice shop could not be made ready. Please try again in a minute." }, { status: 500 });
  }

  const { value, expires } = await makePracticeCookie(secret);
  (await cookies()).set(PRACTICE_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
  return Response.json({ ok: true, minutes: PRACTICE_MINUTES });
}
