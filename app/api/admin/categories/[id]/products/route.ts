import { z } from "zod";
import { and, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { categories, productImages, products } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry, requestIp } from "@/lib/admin/audit";
import { runInBackground } from "@/lib/background";
import { descendantIds } from "@/lib/category-tree";
import { variantKeyFor } from "@/lib/image-variants";
import { reindexAll } from "@/lib/search/algolia";
import { deleteObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Products removed per request: each one also frees its picture files, so a big category is done in several short rounds (the screen repeats the call). */
const DELETE_PER_ROUND = 20;

const bodySchema = z.object({
  /** "archive" hides the products from the website and keeps them (can be shown again). "delete" removes them for good. */
  mode: z.enum(["archive", "delete"]),
  /** Also the categories inside this one (Kurta Pajama → Classic Kurta Pajama ...). */
  includeInside: z.boolean().default(true),
  /** Only count what would happen; nothing is changed. */
  dryRun: z.boolean().default(false),
  /** For "delete": the category name typed by the owner. */
  confirmName: z.string().optional(),
});

/** Hide or delete every product of a category (and, by default, of the categories inside it). The categories themselves stay, ready for a fresh upload. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose archive or delete." }, { status: 400 });
  const { mode, includeInside, dryRun, confirmName } = parsed.data;

  const all = await db.select({ id: categories.id, name: categories.name, slug: categories.slug, parentId: categories.parentId, sortOrder: categories.sortOrder }).from(categories);
  const category = all.find((entry) => entry.id === id);
  if (!category) return Response.json({ error: "Category not found." }, { status: 404 });
  const ids = includeInside ? descendantIds(all, id) : [id];
  const names = all.filter((entry) => ids.includes(entry.id)).map((entry) => entry.name);

  // "archive" skips what is already hidden; "delete" takes everything, hidden ones too.
  const where = mode === "archive" ? and(inArray(products.categoryId, ids), ne(products.status, "archived")) : inArray(products.categoryId, ids);
  const target = await db.select({ id: products.id, name: products.name }).from(products).where(where);

  if (dryRun) return Response.json({ count: target.length, categories: names, sample: target.slice(0, 8).map((entry) => entry.name) });
  if (target.length === 0) return Response.json({ done: 0, remaining: 0, categories: names });

  if (mode === "delete" && (confirmName ?? "").trim().toLowerCase() !== category.name.trim().toLowerCase()) {
    return Response.json({ error: `To delete for good, type the category name: ${category.name}` }, { status: 400 });
  }

  const source = "admin (category)";
  if (mode === "archive") {
    const batch = target.map((entry) => entry.id);
    for (let start = 0; start < batch.length; start += 80) {
      await db.update(products).set({ status: "archived", updatedAt: new Date() }).where(inArray(products.id, batch.slice(start, start + 80)));
    }
    await auditLogEntry({ actorEmail: admin.email, action: "category.products_archive", entityType: "category", entityId: id, detail: { category: category.name, products: batch.length, categories: names }, source, ip: requestIp(request) });
    runInBackground(reindexAll(), "reindexAll");
    return Response.json({ done: batch.length, remaining: 0, categories: names });
  }

  // Delete for good, a few at a time. Variants and picture rows go with the product; past orders keep their own copy of what was bought.
  const round = target.slice(0, DELETE_PER_ROUND).map((entry) => entry.id);
  const images = await db.select({ r2Key: productImages.r2Key, variantWidths: productImages.variantWidths }).from(productImages).where(inArray(productImages.productId, round));
  await db.delete(products).where(inArray(products.id, round));
  // The files are freed only after the rows are really gone, so a failure never leaves a product without its pictures.
  const files = images.flatMap((image) => [image.r2Key, ...(image.variantWidths ?? []).map((width) => variantKeyFor(image.r2Key, width))]);
  for (let start = 0; start < files.length; start += 25) {
    await Promise.all(files.slice(start, start + 25).map((key) => deleteObject(key).catch(() => undefined)));
  }
  const remaining = target.length - round.length;
  await auditLogEntry({ actorEmail: admin.email, action: "category.products_delete", entityType: "category", entityId: id, detail: { category: category.name, products: round.length, remaining, files: files.length }, source, ip: requestIp(request) });
  if (remaining === 0) runInBackground(reindexAll(), "reindexAll");
  return Response.json({ done: round.length, remaining, categories: names });
}

