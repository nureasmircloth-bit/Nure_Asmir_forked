import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { adminOwners, adminSessions } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isLoginRateLimited, recordLoginAttempt, requestIp } from "@/lib/auth/rate-limit";
import { hashToken, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const MIN_PASSWORD_LENGTH = 12;

/**
 * The signed-in owner / developer changes their own password. The current password is asked for again (a stolen session alone cannot take the account
 * over), wrong guesses are counted like sign-in guesses, and every OTHER session of the account is signed out, so a leaked old password or session stops working.
 */
export async function POST(request: Request) {
  if (process.env.SANDBOX === "1") return Response.json({ error: "Not found." }, { status: 404 }); // the training lab has no real accounts
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { currentPassword?: unknown; newPassword?: unknown } | null;
  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!current || !next) return Response.json({ error: "Please fill in both passwords." }, { status: 400 });
  if (next.length < MIN_PASSWORD_LENGTH) return Response.json({ error: `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.` }, { status: 400 });
  if (next.length > 200) return Response.json({ error: "That password is too long." }, { status: 400 });
  if (next === current) return Response.json({ error: "The new password must be different from the current one." }, { status: 400 });
  if (next.toLowerCase().includes(admin.email.split("@")[0].toLowerCase())) return Response.json({ error: "The password must not contain your email name." }, { status: 400 });

  const bucket = `password:${admin.email}`;
  const ip = requestIp(request);
  if (await isLoginRateLimited(bucket, ip)) return Response.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });

  const [owner] = await db.select().from(adminOwners).where(eq(adminOwners.email, admin.email)).limit(1);
  const ok = owner ? await verifyPassword(current, owner.passwordHash) : false;
  await recordLoginAttempt(bucket, ip, ok);
  if (!owner || !ok) return Response.json({ error: "Your current password is not right." }, { status: 400 });

  await db.update(adminOwners).set({ passwordHash: await hashPassword(next) }).where(eq(adminOwners.email, admin.email));
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.delete(adminSessions).where(and(eq(adminSessions.adminEmail, admin.email), ne(adminSessions.tokenHash, hashToken(token))));
  await auditLogEntry({ actorEmail: admin.email, action: "account.password_changed", entityType: "admin", entityId: admin.email });
  return Response.json({ ok: true });
}
