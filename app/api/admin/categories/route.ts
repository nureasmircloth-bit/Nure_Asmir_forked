import { z } from "zod";
import { sandboxRoomMessage } from "@/lib/sandbox";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { slugify } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";
import { isUniqueViolation } from "@/lib/db/errors";
import { CategoryInputError, ensureCategory, parentProblem } from "@/lib/categories";
import { splitCategoryPath } from "@/lib/category-tree";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  subcategories: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sortOrder: z.coerce.number().int().optional(),
  parentId: z.string().min(1).nullable().optional(),
});

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  return Response.json({
    categories: rows.map((row) => ({
      ...row,
      // Versioned so the admin's own preview thumbnail updates immediately after a replace —
      // /api/category-media is cached at Cloudflare's edge as immutable for a year, keyed by URL,
      // and this row's id (unlike a fresh upload's r2Key) never changes across replacements.
      imageUrl: row.imageR2Key ? `/api/category-media/${row.id}?v=${row.updatedAt.getTime()}` : null,
      heroImageUrl: row.heroR2Key ? `/api/category-media/${row.id}?variant=hero&v=${row.updatedAt.getTime()}` : null,
    })),
  });
}

/** Creates a validated category for an authenticated admin after checking practice capacity. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const full = await sandboxRoomMessage("categories"); // practice shop only: a small limit on how much can be created
  if (full) return Response.json({ error: full }, { status: 400 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid category payload." }, { status: 400 });

  const data = parsed.data;
  // A path ("Shirts > Formal Shirts") makes every level that is missing, and answers with the last one.
  if (splitCategoryPath(data.name).length > 1) {
    try {
      const made = await ensureCategory(data.name);
      const [found] = await db.select().from(categories).where(eq(categories.id, made.id)).limit(1);
      return Response.json({ category: found }, { status: 201 });
    } catch (error) {
      if (error instanceof CategoryInputError) return Response.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  const slug = slugify(data.slug || data.name);
  if (data.parentId) {
    const problem = await parentProblem(null, data.parentId);
    if (problem) return Response.json({ error: problem }, { status: 400 });
  }

  let row;
  try {
    [row] = await db
      .insert(categories)
      .values({
        name: data.name,
        slug,
        description: data.description || null,
        subcategories: data.subcategories || null,
        parentId: data.parentId || null,
        status: data.status ?? "active",
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ error: `A category with a matching URL slug ("${slug}") already exists.` }, { status: 409 });
    }
    throw error;
  }

  await auditLogEntry({ actorEmail: admin.email, action: "category.create", entityType: "category", entityId: row.id, detail: data });

  return Response.json({ category: row }, { status: 201 });
}
