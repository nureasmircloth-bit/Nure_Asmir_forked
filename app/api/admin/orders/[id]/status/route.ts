import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { moveOrder } from "@/lib/order-actions";

export const dynamic = "force-dynamic";

// Cancelling has its own rules (only until TCS has the parcel) and its own route: ./cancel.
const bodySchema = z.object({ toStatus: z.enum(["confirmed", "processing", "packed", "shipped", "delivered", "returned"]), note: z.string().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Please choose what to do with this order." }, { status: 400 });

  const result = await moveOrder(id, parsed.data.toStatus, admin.email, parsed.data.note);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ order: result.order, courierNotice: result.courierNotice ?? null });
}
