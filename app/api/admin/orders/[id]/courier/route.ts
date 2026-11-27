import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { bookOrderWithTcs, saveManualTracking, syncCourierStatuses } from "@/lib/courier";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("book"),
    customerPhone: z.string().max(30).optional(),
    cityName: z.string().max(60).optional(),
    address: z.string().max(400).optional(),
    codAmount: z.coerce.number().int().min(0).max(250_000).optional(),
    pieces: z.coerce.number().int().min(1).max(50).optional(),
    weightKg: z.coerce.number().min(0.5).max(100).optional(),
    fragile: z.boolean().optional(),
    remarks: z.string().max(400).optional(),
  }),
  z.object({ action: z.literal("manual"), trackingNumber: z.string().min(3).max(40), courierName: z.string().max(40).optional() }),
  z.object({ action: z.literal("sync") }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Please check the details and try again." }, { status: 400 });
  const body = parsed.data;

  if (body.action === "sync") {
    const summary = await syncCourierStatuses({ orderId: id, force: true });
    return Response.json({ ok: true, summary });
  }
  const result = body.action === "manual" ? await saveManualTracking(id, body.trackingNumber, admin.email, body.courierName) : await bookOrderWithTcs(id, admin.email, body);
  if (!result.ok) {
    const status = result.kind === "not_found" ? 404 : result.kind === "conflict" ? 409 : result.kind === "tcs" && result.retryable ? 502 : 400;
    return Response.json({ error: result.message, kind: result.kind }, { status });
  }
  return Response.json({ ok: true, trackingNumber: result.trackingNumber });
}
