import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { subscribers } from "@/db/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

const schema = z.object({ e: z.string().trim().email().max(200), t: z.string().trim().min(8).max(64) });

/** Takes an address off the email list. The link in each email carries a signature, so only the person who got the email can use it. */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "This link is not valid." }, { status: 400 });
  const email = parsed.data.e.toLowerCase();
  if (!(await verifyUnsubscribeToken(email, parsed.data.t))) return Response.json({ error: "This link is not valid." }, { status: 400 });
  await db.update(subscribers).set({ status: "unsubscribed", updatedAt: new Date() }).where(eq(subscribers.email, email));
  return Response.json({ ok: true });
}
