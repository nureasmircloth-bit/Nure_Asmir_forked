import { z } from "zod";
import { runInBackground } from "@/lib/background";
import { reindexAll } from "@/lib/search/algolia";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { slugify } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";
import { isUniqueViolation } from "@/lib/db/errors";
import { parentProblem } from "@/lib/categories";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  subcategories: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sortOrder: z.coerce.number().int().optional(),
  parentId: z.string().min(1).nullable().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid category payload." }, { status: 400 });
  const data = parsed.data;

  if (data.parentId) {
    const problem = await parentProblem(id, data.parentId);
    if (problem) return Response.json({ error: problem }, { status: 400 });
  }

  const nextSlug = data.slug !== undefined ? slugify(data.slug) : undefined;

  let row;
  try {
    [row] = await db
      .update(categories)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
        ...(data.description !== undefined ? { description: data.description || null } : {}),
        ...(data.subcategories !== undefined ? { subcategories: data.subcategories || null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
        updatedAt: new Date(),
      })
      // the loop check is part of the write itself: a category is only moved under a parent that is not inside it, even when two moves race
      .where(and(eq(categories.id, id), data.parentId ? sql`${data.parentId} not in (with recursive inside(id) as (select ${id} union select c.id from categories c join inside on c.parent_id = inside.id) select id from inside)` : undefined))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ error: `A category with a matching URL slug ("${nextSlug}") already exists.` }, { status: 409 });
    }
    throw error;
  }

  if (!row) {
    const [exists] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).limit(1);
    if (exists) return Response.json({ error: "A category cannot be moved inside itself or inside one of its own categories." }, { status: 400 });
    return Response.json({ error: "Category not found." }, { status: 404 });
  }

  await auditLogEntry({ actorEmail: admin.email, action: "category.update", entityType: "category", entityId: id, detail: data });

  // Category name/slug are part of every product record in the search index.
  runInBackground(reindexAll(), "reindexAll");

  return Response.json({ category: row });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const [row] = await db
    .update(categories)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();
  if (!row) return Response.json({ error: "Category not found." }, { status: 404 });

  await auditLogEntry({ actorEmail: admin.email, action: "category.deactivate", entityType: "category", entityId: id });

  return Response.json({ ok: true });
}
