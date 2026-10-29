import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { slugify } from "@/lib/slug";

const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

/**
 * The category with this name (capital letters ignored), created on the spot when it does not exist yet. Used by the Excel import and the product
 * form, so typing a new category name simply makes it. A new category goes to the end of the list and is active.
 */
export async function ensureCategory(rawName: string): Promise<{ id: string; name: string }> {
  const name = tidy(rawName);
  if (!name) throw new Error("Category name is empty.");
  // A shop has a handful of categories: reading them all is cheaper and safer than a pattern search.
  const load = () => db.select({ id: categories.id, name: categories.name, sortOrder: categories.sortOrder }).from(categories);
  const match = (rows: Awaited<ReturnType<typeof load>>) => rows.find((row) => row.name.trim().toLowerCase() === name.toLowerCase());

  const rows = await load();
  const existing = match(rows);
  if (existing) return { id: existing.id, name: existing.name };

  const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
  const base = slugify(name) || "category";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [created] = await db
        .insert(categories)
        .values({ name, slug: attempt ? `${base}-${attempt + 1}` : base, status: "active", sortOrder })
        .returning({ id: categories.id, name: categories.name });
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const again = match(await load()); // somebody made it at the same moment
      if (again) return { id: again.id, name: again.name };
    }
  }
  throw new Error(`Could not create the category "${name}".`);
}

/**
 * Adds a subcategory name to the category's list when it is not there yet (capitals ignored). Names already written are never changed, removed or
 * reordered. Returns false only when the list could not be written (it kept changing underneath us), true when the name is now in the list.
 */
export async function addSubcategory(categoryId: string, rawName: string): Promise<boolean> {
  const name = tidy(rawName).slice(0, 60);
  if (!name) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db.select({ subcategories: categories.subcategories }).from(categories).where(eq(categories.id, categoryId)).limit(1);
    if (!row) return false;
    const current = row.subcategories ?? "";
    const names = current.split(",").map((part) => part.trim()).filter(Boolean);
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) return true;
    // Only if nobody changed the list in the meantime (the owner may be editing it); otherwise read again and retry.
    const changed = await db
      .update(categories)
      .set({ subcategories: [...names, name].join(", "), updatedAt: new Date() })
      .where(and(eq(categories.id, categoryId), current ? eq(categories.subcategories, current) : isNull(categories.subcategories)))
      .returning({ id: categories.id });
    if (changed.length) return true;
  }
  return false;
}
