import { z } from "zod";
import { reserveLookup, requestIp } from "@/lib/auth/rate-limit";
import { findOrderForShopper } from "@/lib/order-access";
import { PAYOUT_METHODS, REFUND_REASONS } from "@/lib/order-rules";
import { submitCustomerRefund } from "@/lib/refunds";
import { newObjectKey, putObject } from "@/lib/storage";
import { validateImageUpload } from "@/lib/validation";

export const dynamic = "force-dynamic";

const fieldsSchema = z.object({
  orderNumber: z.string().min(3).max(40),
  phone: z.string().min(4).max(30),
  reason: z.enum(REFUND_REASONS.map((reason) => reason.value) as [string, ...string[]]),
  details: z.string().trim().max(1000).default(""),
  payoutMethod: z.enum(PAYOUT_METHODS.map((method) => method.value) as [string, ...string[]]),
  payoutAccount: z.string().trim().min(6, "Please enter the account or mobile-wallet number we should pay.").max(60),
  payoutTitle: z.string().trim().min(3, "Please enter the name on that account.").max(80),
});

/** A shopper asks for a refund (with optional photos). The owner reviews it in Admin → Refunds. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Please try again." }, { status: 400 });
  const parsed = fieldsSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Please check the form." }, { status: 400 });
  const data = parsed.data;

  const ip = requestIp(request);
  const guard = await reserveLookup("order-lookup", ip);
  if (!guard.allowed) return Response.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });
  const order = await findOrderForShopper(data.orderNumber, data.phone);
  if (!order) return Response.json({ error: "No matching order was found." }, { status: 404 });
  await guard.release(); // a real match does not use up the allowance

  const files = form.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0).slice(0, 3);
  const photoKeys: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateImageUpload(file.type, bytes);
    if (!check.ok) return Response.json({ error: check.error }, { status: 400 });
    const key = newObjectKey(`refunds/${order.id}`, file.type);
    await putObject(key, bytes, file.type, "private");
    photoKeys.push(key);
  }

  const result = await submitCustomerRefund(order, { reason: data.reason, details: data.details, payoutMethod: data.payoutMethod, payoutAccount: data.payoutAccount, payoutTitle: data.payoutTitle, photoKeys });
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true }, { status: 201 });
}
