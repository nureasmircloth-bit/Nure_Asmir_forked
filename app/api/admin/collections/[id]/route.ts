import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { collections, productCollections } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { slugify } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";
import { isUniqueViolation } from "@/lib/db/errors";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sortOrder: z.coerce.number().int().optional(),
  productIds: z.array(z.string().uuid()).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid collection payload." }, { status: 400 });
  const data = parsed.data;

  const hasFieldUpdate =
    data.name !== undefined ||
    data.slug !== undefined ||
    data.description !== undefined ||
    data.status !== undefined ||
    data.sortOrder !== undefined;

  const nextSlug = data.slug !== undefined ? slugify(data.slug) : undefined;

  let row = null;
  if (hasFieldUpdate) {
    try {
      [row] = await db
        .update(collections)
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
          ...(data.description !== undefined ? { description: data.description || null } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(collections.id, id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        return Response.json({ error: `A collection with a matching URL slug ("${nextSlug}") already exists.` }, { status: 409 });
      }
      throw error;
    }
    if (!row) return Response.json({ error: "Collection not found." }, { status: 404 });
  }

  if (data.productIds !== undefined) {
    await db.delete(productCollections).where(eq(productCollections.collectionId, id));
    if (data.productIds.length) {
      // in pieces: the database takes at most 100 values in one statement
      for (const part of chunked(data.productIds, 40)) await db.insert(productCollections).values(part.map((productId) => ({ productId, collectionId: id })));
    }
  }

  await auditLogEntry({
    actorEmail: admin.email,
    action: "collection.update",
    entityType: "collection",
    entityId: id,
    detail: { ...data, productIds: data.productIds?.length },
  });

  return Response.json({ ok: true, collection: row });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const [row] = await db
    .update(collections)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning();
  if (!row) return Response.json({ error: "Collection not found." }, { status: 404 });

  await auditLogEntry({ actorEmail: admin.email, action: "collection.deactivate", entityType: "collection", entityId: id });

  return Response.json({ ok: true });
}
