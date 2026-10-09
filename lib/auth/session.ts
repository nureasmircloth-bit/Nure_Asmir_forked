import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminOwners } from "@/db/schema";

export const SESSION_COOKIE = "ms_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(adminEmail: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(adminSessions).values({ tokenHash: hashToken(token), adminEmail, expiresAt });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

export type SessionAdmin = { email: string; displayName: string | null; role: string };

export async function getSessionAdmin(): Promise<SessionAdmin | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      email: adminOwners.email,
      displayName: adminOwners.displayName,
      role: adminOwners.role,
      expiresAt: adminSessions.expiresAt,
    })
    .from(adminSessions)
    .innerJoin(adminOwners, eq(adminSessions.adminEmail, adminOwners.email))
    .where(eq(adminSessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
    return null;
  }
  return { email: row.email, displayName: row.displayName, role: row.role };
}
