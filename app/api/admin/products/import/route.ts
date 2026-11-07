import { runInBackground } from "@/lib/background";
import { reindexAll } from "@/lib/search/algolia";
import { CategoryInputError } from "@/lib/categories";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";
import { importOne, type ImportResult } from "@/lib/import/import-product";
import { productImportBatchSchema } from "@/lib/import/product-import-schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = productImportBatchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid import payload.", details: parsed.error.issues }, { status: 400 });
  }
  const items = "products" in parsed.data ? parsed.data.products : [parsed.data];

  const results: ImportResult[] = [];
  for (let index = 0; index < items.length; index++) {
    try {
      results.push(await importOne(items[index], index));
    } catch (error) {
      if (error instanceof CategoryInputError) {
        results.push({ index, name: items[index].name, success: false, error: error.message });
        continue;
      }
      console.error("product.import failed", error);
      results.push({ index, name: items[index].name, success: false, error: "Unexpected server error — see logs." });
    }
  }

  const succeeded = results.filter((r) => r.success);
  if (succeeded.length) {
    await auditLogEntry({
      actorEmail: admin.email,
      action: "product.import",
      entityType: "product",
      entityId: succeeded.map((r) => r.productId).join(","),
      detail: { imported: succeeded.length, failed: results.length - succeeded.length },
    });
  }

  // Bulk import touched many products — rebuild the search index once rather than per product.
  // The bulk-upload screen sends small batches and asks for one rebuild at the very end (?reindex=0).
  if (succeeded.length && new URL(request.url).searchParams.get("reindex") !== "0") runInBackground(reindexAll(), "reindexAll");

  return Response.json({ results });
}
