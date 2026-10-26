import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customerPushDevices, orders } from "@/db/schema";
import { pushConfigured } from "@/lib/push/fcm";
import { requestIp } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const bodySchema = z.object({
  token: z.string().min(20).max(4096),
  /** Subscribe this device to updates for one order — requires the phone number used at checkout. */
  orderNumber: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(30).optional(),
  /** Full wishlist (product ids) for sale alerts; replaces what is stored. */
  wishlist: z.array(uuid).max(100).optional(),
  salesOptIn: z.boolean().optional(),
});

// Per-isolate throttle: registrations are cheap but unauthenticated.
const hits = new Map<string, number[]>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
}

/** Strips everything but digits, so phone numbers can be compared regardless of formatting. */
const digits = (value: string) => value.replace(/\D/g, "");

/** Registers/updates a shopper device for order updates and sale alerts. */
export async function POST(request: Request) {
  const ip = requestIp(request);
  if (throttled(ip)) return Response.json({ error: "Too many requests." }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { token, orderNumber, phone, wishlist, salesOptIn } = parsed.data;

  // Order updates are private: the order number alone is guessable-ish, so also require the phone.
  let verifiedOrder: string | null = null;
  if (orderNumber) {
    const [order] = await db
      .select({ orderNumber: orders.orderNumber, customerPhone: orders.customerPhone })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);
    const given = digits(phone ?? "");
    const stored = digits(order?.customerPhone ?? "");
    if (!order || given.length < 10 || stored.slice(-10) !== given.slice(-10)) {
      return Response.json({ error: "We couldn't match that order and phone number." }, { status: 403 });
    }
    verifiedOrder = order.orderNumber;
  }

  await db
    .insert(customerPushDevices)
    .values({
      token,
      orderNumbers: verifiedOrder ? [verifiedOrder] : [],
      wishlist: wishlist ?? [],
      salesOptIn: salesOptIn ?? false,
    })
    .onConflictDoUpdate({
      target: customerPushDevices.token,
      set: {
        lastSeenAt: new Date(),
        ...(wishlist ? { wishlist } : {}),
        ...(salesOptIn !== undefined ? { salesOptIn } : {}),
        // Append the order (de-duplicated, newest 20 kept) without clobbering previously linked orders.
        ...(verifiedOrder
          ? {
              orderNumbers: sql`(
                select coalesce(json_group_array(v), '[]') from (
                  select distinct value as v from (
                    select value from json_each(${customerPushDevices.orderNumbers})
                    union all select value from json_each(${JSON.stringify([verifiedOrder])})
                  ) order by v desc limit 20
                )
              )`,
            }
          : {}),
      },
    });
  return Response.json({ ok: true, ready: pushConfigured() }, { status: 201 });
}

export async function DELETE(request: Request) {
  const parsed = z.object({ token: z.string().min(20).max(4096) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  await db.delete(customerPushDevices).where(and(eq(customerPushDevices.token, parsed.data.token)));
  return Response.json({ ok: true });
}
