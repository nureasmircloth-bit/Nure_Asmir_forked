import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry, requestIp } from "@/lib/admin/audit";
import { planSheetUpdate } from "@/lib/import/sheet-update";
import { planChanges, refreshAfter } from "@/lib/mcp/manage-tools";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  products: z.array(z.object({ name: z.string().min(1).max(200), colour: z.string().min(1).max(100), variants: z.array(z.object({ size: z.string().max(60), price: z.number().int().min(0), oldPrice: z.number().int().min(0).nullable(), stock: z.number().int().min(0) })).max(100) })).max(2000),
  updateExisting: z.boolean().default(false),
  apply: z.boolean().default(false),
});

/**
 * A sheet that mentions products that already exist. With apply=false: says which products exist and what would change (new sizes added, and, if asked, prices and stock of
 * existing sizes brought in line). With apply=true: does it, with one history entry for each change. Products that do not exist are not touched here (the normal upload creates them).
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid payload." }, { status: 400 });

  const sheet = await planSheetUpdate(parsed.data.products, { updateExisting: parsed.data.updateExisting });
  if (sheet.changes.length === 0) return Response.json({ existing: sheet.existing, notes: sheet.notes, problems: [], preview: [], results: [] });
  const { plans, problems } = await planChanges(sheet.changes.slice(0, 100));
  if (!parsed.data.apply) return Response.json({ existing: sheet.existing, notes: sheet.notes, problems, preview: plans.map((item) => ({ item: item.label, changes: item.what })), truncated: sheet.changes.length > 100 });
  if (problems.length) return Response.json({ error: `Nothing was changed: ${problems.slice(0, 6).join(" | ")}`, problems }, { status: 400 });

  const results: Array<{ item: string; ok: boolean; changes?: string[]; message?: string }> = [];
  const done = new Set<string>();
  for (const item of plans) {
    try {
      await item.apply();
      results.push({ item: item.label, ok: true, changes: item.what });
      done.add(item.productId);
      await auditLogEntry({ actorEmail: admin.email, action: item.variantId ? "variant.update" : "product.update", entityType: item.variantId ? "variant" : "product", entityId: item.variantId ?? item.productId, detail: item.what, source: "admin (bulk upload)", ip: requestIp(request) }).catch((error) => console.error("history entry failed", error));
    } catch (error) {
      console.error("sheet update failed", error);
      results.push({ item: item.label, ok: false, message: error instanceof Error ? error.message : "Could not be changed." });
    }
  }
  if (done.size) await refreshAfter([...done]);
  return Response.json({ existing: sheet.existing, notes: sheet.notes, results, truncated: sheet.changes.length > 100 });
}
