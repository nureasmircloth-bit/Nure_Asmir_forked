import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hideLongSoldOut } from "@/lib/soldout-cleanup";
import { refreshStorageStats } from "@/lib/storage-stats";

export const dynamic = "force-dynamic";

const EVERY_MS = 20 * 60 * 60 * 1000; // the workflow calls this every few minutes; the work runs about once a day

/** Daily housekeeping: measure both picture stores, hide products that have been sold out for the owner's chosen time, and forget old sign-in and lookup attempts. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force) {
    const result = (await db.execute(sql`select updated_at from service_stats where key = 'maintenance:last' limit 1`)) as unknown as { rows: Array<{ updated_at: string | Date }> };
    const last = result.rows?.[0]?.updated_at;
    if (last && Date.now() - new Date(last).getTime() < EVERY_MS) return Response.json({ ok: true, skipped: true });
  }
  await db.execute(sql`insert into service_stats (key, value, updated_at) values ('maintenance:last', '{}'::jsonb, now()) on conflict (key) do update set updated_at = now()`);

  // Attempts only matter for 15 minutes (see lib/auth/rate-limit.ts); a day is plenty, and the table would otherwise grow for ever.
  const [storage, soldOut, pruned] = await Promise.allSettled([refreshStorageStats(), hideLongSoldOut(), db.execute(sql`delete from login_attempts where created_at < now() - interval '1 day'`)]);
  return Response.json({
    ok: true,
    storage: storage.status === "fulfilled" ? storage.value.map((s) => ({ backend: s.backend, bytes: s.bytes, error: s.error })) : String(storage.reason),
    soldOut: soldOut.status === "fulfilled" ? { days: soldOut.value.days, hidden: soldOut.value.hidden.length } : String(soldOut.reason),
    attemptsPruned: pruned.status === "fulfilled" ? true : String(pruned.reason),
  });
}
