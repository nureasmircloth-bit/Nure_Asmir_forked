import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminOwners } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isLoginRateLimited, recordLoginAttempt } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  // The training lab has its own entrance (/api/admin/sandbox/enter); real sign-in does not exist there.
  if (process.env.SANDBOX === "1") return Response.json({ error: "Not found." }, { status: 404 });
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const ip = clientIp(request);

  if (!email || !password) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (await isLoginRateLimited(email, ip)) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const [owner] = await db.select().from(adminOwners).where(eq(adminOwners.email, email)).limit(1);
  const success = owner ? await verifyPassword(password, owner.passwordHash) : false;
  await recordLoginAttempt(email, ip, success);

  if (!owner || !success) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await createSession(owner.email);
  return Response.json({ ok: true });
}
