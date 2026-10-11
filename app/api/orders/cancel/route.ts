import { z } from "zod";
import { reserveLookup, requestIp } from "@/lib/auth/rate-limit";
import { findOrderForShopper } from "@/lib/order-access";
import { cancelOrder } from "@/lib/order-actions";
import { CUSTOMER_CANCEL_REASONS } from "@/lib/order-rules";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderNumber: z.string().min(3).max(40),
  phone: z.string().min(4).max(30),
  reason: z.enum(CUSTOMER_CANCEL_REASONS.map((reason) => reason.value) as [string, ...string[]]),
  note: z.string().max(300).optional(),
});

/** "Cancel my order" on the tracking page. Allowed only until TCS has the parcel – enforced in cancelOrder. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please choose a reason for cancelling." }, { status: 400 });
  const ip = requestIp(request);
  const guard = await reserveLookup("order-lookup", ip);
  if (!guard.allowed) return Response.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });
  const order = await findOrderForShopper(parsed.data.orderNumber, parsed.data.phone);
  if (!order) return Response.json({ error: "No matching order was found." }, { status: 404 });
  await guard.release(); // a real match does not use up the allowance

  const result = await cancelOrder(order.id, { kind: "customer" }, parsed.data.reason, parsed.data.note);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, refundOpened: result.refundOpened });
}
