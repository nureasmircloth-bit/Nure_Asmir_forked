import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry, requestIp } from "@/lib/admin/audit";
import { deleteObject, newObjectKey, putObject } from "@/lib/storage";
import { validateImageUpload } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Sets or replaces the size chart picture of a category. The picture is kept exactly as uploaded (no cropping), so all its numbers stay readable. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const [existing] = await db.select({ key: categories.sizeChartR2Key }).from(categories).where(eq(categories.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Category not found." }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a picture of the size chart." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const check = validateImageUpload(contentType, bytes);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const key = newObjectKey("categories", contentType);
  await putObject(key, bytes, contentType);
  await db.update(categories).set({ sizeChartR2Key: key, updatedAt: new Date() }).where(eq(categories.id, id));
  // the old picture is removed only after the new one is saved
  if (existing.key) await deleteObject(existing.key).catch(() => undefined);
  await auditLogEntry({ actorEmail: admin.email, action: "category.size_chart.update", entityType: "category", entityId: id, source: "admin", ip: requestIp(request) });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const [existing] = await db.select({ key: categories.sizeChartR2Key }).from(categories).where(eq(categories.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Category not found." }, { status: 404 });
  await db.update(categories).set({ sizeChartR2Key: null, updatedAt: new Date() }).where(eq(categories.id, id));
  if (existing.key) await deleteObject(existing.key).catch(() => undefined);
  await auditLogEntry({ actorEmail: admin.email, action: "category.size_chart.remove", entityType: "category", entityId: id, source: "admin", ip: requestIp(request) });
  return Response.json({ ok: true });
}
