import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { pendingPictures } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * “Skip”: the owner stops waiting for a picture (for example the file does not exist), so the product can be published without it. A picture that WAS added is crossed off by the
 * picture route itself in the same request that saves it (app/api/admin/images), so this is only for skipping. Only the rows named are removed, and each one is written to the activity log.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = ((await request.json().catch(() => null)) ?? {}) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) : [];
  if (!ids.length || ids.length > 90) return Response.json({ error: "Send between 1 and 90 picture ids." }, { status: 400 });
  const rows = await db.select({ id: pendingPictures.id, productId: pendingPictures.productId, fileName: pendingPictures.fileName }).from(pendingPictures).where(inArray(pendingPictures.id, ids));
  await db.delete(pendingPictures).where(inArray(pendingPictures.id, ids));
  for (const row of rows) {
    await auditLogEntry({ actorEmail: admin.email, action: "product.picture_skipped", entityType: "product", entityId: row.productId, detail: { pendingPictureId: row.id, file: row.fileName, reason: "the owner stopped waiting for this picture" } });
  }
  return Response.json({ ok: true, removed: rows.length });
}
