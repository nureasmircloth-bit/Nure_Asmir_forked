import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminOwners } from "@/db/schema";
import { isLoginRateLimited, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { createSession } from "@/lib/auth/session";
import { isPracticeRequest } from "@/lib/practice-context";

export const dynamic = "force-dynamic";

/** Most different trainee names kept at once (after that, newcomers share one general trainee, so nobody can fill the table). */
const MAX_TRAINEES = 40;
const SHARED_TRAINEE = "trainee@training.local";

const scryptAsync = promisify(scrypt);
const COMPARE_SALT = "nure-asmir-training-lab";

/** Compares two secrets without leaking where they differ: both are stretched with scrypt (slow on purpose) and the results compared in constant time. */
async function samePassword(given: string, expected: string): Promise<boolean> {
  const [a, b] = (await Promise.all([scryptAsync(given, COMPARE_SALT, 32), scryptAsync(expected, COMPARE_SALT, 32)])) as [Buffer, Buffer];
  return timingSafeEqual(a, b);
}

/** The e-mail style name that stands for one trainee inside the lab (it never leaves the practice tables). */
function traineeEmail(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return slug ? `trainee-${slug}@training.local` : SHARED_TRAINEE;
}

/**
 * The entrance of the training lab: a name and the shared training password (the TRAINING_PASSWORD secret). Only exists on the
 * training Worker; it signs the trainee in to a pretend owner account inside the practice tables. The real admin's accounts, passwords
 * and database are never involved.
 */
export async function POST(request: Request) {
  if (!isPracticeRequest()) return Response.json({ error: "Not found." }, { status: 404 });
  const training = process.env.TRAINING_PASSWORD;
  if (!training) return Response.json({ error: "The training lab has no password yet. Please ask your developer to set one." }, { status: 503 });

  let body: { name?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name) return Response.json({ error: "Please type your name." }, { status: 400 });

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("cf-connecting-ip") || "unknown";
  if (await isLoginRateLimited("training-lab", ip)) return Response.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });
  const ok = await samePassword(password, training);
  await recordLoginAttempt("training-lab", ip, ok);
  if (!ok) return Response.json({ error: "That training password is not right. Please check it and try again." }, { status: 401 });

  let email = traineeEmail(name);
  const [existing] = await db.select({ email: adminOwners.email }).from(adminOwners).where(eq(adminOwners.email, email)).limit(1);
  if (!existing) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(adminOwners).where(like(adminOwners.email, "trainee-%@training.local"));
    if (n >= MAX_TRAINEES) email = SHARED_TRAINEE;
  }
  // The stored password is not a real hash on purpose: nobody can sign in with it, the entrance above is the only way in.
  await db.insert(adminOwners).values({ email, displayName: name, passwordHash: "training-lab-no-password", role: "owner" }).onConflictDoUpdate({ target: adminOwners.email, set: { displayName: name } });
  await createSession(email);
  return Response.json({ ok: true });
}
