import { z } from "zod";
import { sandboxRoomMessage } from "@/lib/sandbox";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { slugify } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";
import { isUniqueViolation } from "@/lib/db/errors";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sortOrder: z.coerce.number().int().optional(),
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

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const full = await sandboxRoomMessage("categories"); // practice shop only: a small limit on how much can be created
  if (full) return Response.json({ error: full }, { status: 400 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid category payload." }, { status: 400 });

  const data = parsed.data;
  const slug = slugify(data.slug || data.name);

  let row;
  try {
    [row] = await db
      .insert(categories)
      .values({
        name: data.name,
        slug,
        description: data.description || null,
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
