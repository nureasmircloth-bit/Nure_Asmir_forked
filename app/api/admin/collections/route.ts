import { z } from "zod";
import { sandboxRoomMessage } from "@/lib/sandbox";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { collections, productCollections } from "@/db/schema";
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

  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      status: collections.status,
      sortOrder: collections.sortOrder,
      productCount: sql<number>`count(${productCollections.productId})`,
    })
    .from(collections)
    .leftJoin(productCollections, eq(productCollections.collectionId, collections.id))
    .groupBy(collections.id)
    .orderBy(asc(collections.sortOrder), asc(collections.name));

  const assignments = await db
    .select({ collectionId: productCollections.collectionId, productId: productCollections.productId })
    .from(productCollections);

  return Response.json({
    collections: rows.map((row) => ({ ...row, productCount: Number(row.productCount) })),
    assignments,
  });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const full = await sandboxRoomMessage("collections"); // practice shop only: a small limit on how much can be created
  if (full) return Response.json({ error: full }, { status: 400 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid collection payload." }, { status: 400 });
  const data = parsed.data;
  const slug = slugify(data.slug || data.name);

  let row;
  try {
    [row] = await db
      .insert(collections)
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
      return Response.json({ error: `A collection with a matching URL slug ("${slug}") already exists.` }, { status: 409 });
    }
    throw error;
  }

  await auditLogEntry({ actorEmail: admin.email, action: "collection.create", entityType: "collection", entityId: row.id, detail: data });

  return Response.json({ collection: row }, { status: 201 });
}
