import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { practiceDb } from "@/db";
import { adminSessions } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { hashToken, SESSION_COOKIE } from "@/lib/auth/session";
import { PRACTICE_COOKIE } from "@/lib/practice-cookie";
import { practiceAvailable } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

/** Leaves the practice shop: the browser goes back to the real tables on the next click. Safe to call at any time. */
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(PRACTICE_COOKIE);
  if (token && practiceAvailable()) await practiceDb().delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token))).catch(() => undefined);
  return Response.json({ ok: true });
}
