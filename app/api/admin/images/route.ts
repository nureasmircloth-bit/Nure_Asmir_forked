import { and, eq } from "drizzle-orm";
import { runInBackground } from "@/lib/background";
import { syncProductSearch } from "@/lib/search/algolia";
import { db } from "@/db";
import { pendingPictures, productImages } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { validateImageUpload } from "@/lib/validation";
import { newObjectKey, putObject } from "@/lib/storage";
import { auditLogEntry } from "@/lib/admin/audit";
import { variantKeyFor } from "@/lib/image-variants";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const productId = form.get("productId");
  const variantId = form.get("variantId");
  const altText = form.get("altText");
  const sortOrder = form.get("sortOrder");
  const isPrimary = form.get("isPrimary");
  // Set by the “Pictures for new products” page: the waiting-list entry this picture answers, crossed off below once the picture is saved.
  const pendingPictureId = form.get("pendingPictureId");

  if (!(file instanceof File)) return Response.json({ error: "An image file is required." }, { status: 400 });
  if (typeof productId !== "string" || !productId) return Response.json({ error: "productId is required." }, { status: 400 });
  if (typeof altText !== "string" || !altText.trim()) {
    return Response.json({ error: "Image description (alt text) is required." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const validation = validateImageUpload(contentType, bytes);
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const key = newObjectKey("products", contentType);
  await putObject(key, bytes, contentType);

  // Resized WebP variants + a blur-up placeholder are generated in the admin's browser (see
  // lib/client-image-processing.ts) and arrive here already encoded — the server just validates
  // and stores them. This keeps real image-codec CPU work off the deployed Worker entirely, which
  // matters because Cloudflare's free-tier CPU-time-per-request budget (10ms) is far too small for
  // it. If the client didn't send variants (older browser, or its processing failed), we simply
  // store the original — never a hard failure.
  let width: number | undefined;
  let height: number | undefined;
  let blurDataUrl: string | undefined;
  const storedVariantWidths: number[] = [];

  const widthField = form.get("width");
  const heightField = form.get("height");
  const blurField = form.get("blurDataUrl");
  const variantWidthsField = form.get("variantWidths");
  if (typeof widthField === "string" && widthField) width = Number(widthField);
  if (typeof heightField === "string" && heightField) height = Number(heightField);
  if (typeof blurField === "string" && blurField.startsWith("data:image/webp;base64,")) blurDataUrl = blurField;

  if (typeof variantWidthsField === "string") {
    let widths: unknown;
    try {
      widths = JSON.parse(variantWidthsField);
    } catch {
      widths = [];
    }
    if (Array.isArray(widths)) {
      for (const w of widths) {
        if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) continue;
        const variantFile = form.get(`variant_${w}`);
        if (!(variantFile instanceof File)) continue;
        const variantBytes = new Uint8Array(await variantFile.arrayBuffer());
        const variantValidation = validateImageUpload("image/webp", variantBytes);
        if (!variantValidation.ok) continue;
        await putObject(variantKeyFor(key, w), variantBytes, "image/webp");
        storedVariantWidths.push(w);
      }
    }
  }

  const makePrimary = isPrimary === "true" || isPrimary === "on";
  if (makePrimary) {
    await db.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, productId));
  }

  const [row] = await db
    .insert(productImages)
    .values({
      productId,
      variantId: typeof variantId === "string" && variantId ? variantId : null,
      r2Key: key,
      altText: altText.trim(),
      contentType,
      byteSize: bytes.byteLength,
      width,
      height,
      blurDataUrl,
      variantWidths: storedVariantWidths.length ? storedVariantWidths : undefined,
      sortOrder: typeof sortOrder === "string" && sortOrder ? Number(sortOrder) : 0,
      isPrimary: makePrimary,
    })
    .returning();

  if (typeof pendingPictureId === "string" && /^[0-9a-f-]{36}$/i.test(pendingPictureId)) {
    await db.delete(pendingPictures).where(and(eq(pendingPictures.id, pendingPictureId), eq(pendingPictures.productId, productId)));
  }

  await auditLogEntry({
    actorEmail: admin.email,
    action: "image.create",
    entityType: "product",
    entityId: productId,
    detail: { imageId: row.id, altText: row.altText, ...(typeof pendingPictureId === "string" && pendingPictureId ? { fromWaitingList: pendingPictureId } : {}) },
  });

  runInBackground(syncProductSearch(productId), "syncProductSearch");

  return Response.json({ image: row }, { status: 201 });
}
