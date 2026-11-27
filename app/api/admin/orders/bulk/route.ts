import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { bookOrderWithTcs } from "@/lib/courier";
import { moveOrder } from "@/lib/order-actions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(40), action: z.enum(["confirm", "packed", "book_tcs", "tcs_collected"]) });

/** Does one thing to many orders (checked boxes on the order list), one by one, and reports each result so
 * a single bad address never blocks the rest. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Please tick some orders first." }, { status: 400 });
  const { ids, action } = parsed.data;

  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const id of ids) {
    if (action === "book_tcs") {
      const result = await bookOrderWithTcs(id, admin.email);
      results.push({ id, ok: result.ok, message: result.ok ? `TCS tracking ${result.trackingNumber}` : result.message });
    } else {
      const to = action === "confirm" ? "confirmed" : action === "packed" ? "packed" : "shipped";
      const result = await moveOrder(id, to, admin.email);
      results.push({ id, ok: result.ok, message: result.ok ? (result.courierNotice?.text ?? "Done") : result.error });
    }
  }
  return Response.json({ results, done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
