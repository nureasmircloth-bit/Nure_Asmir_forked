import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Trivial DB round-trip for uptime checks. It is no longer pinged on a timer (that kept Neon awake and used up the free compute allowance).
 * Original note: Neon's free tier
 * suspends its compute after 5 minutes of inactivity; the first query after that wakes it back up,
 * which can take anywhere from a couple of seconds to ~20s — long enough that a customer landing
 * on the site mid-wake sometimes sees a timeout/error page. Keeping a query flowing at least every
 * 5 minutes means the site is basically never the one to trigger that wake-up. */
export async function GET() {
  await db.execute(sql`select 1`);
  return Response.json({ ok: true });
}
