import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { ancestry, MAX_DEPTH, splitCategoryPath, wouldLoop, type TreeNode } from "@/lib/category-tree";
import { slugify } from "@/lib/slug";

/** A category name the owner typed that cannot be used (ambiguous, empty, too deep); its message is shown to them as it is. */
export class CategoryInputError extends Error {}

/** Why a category cannot be put inside this parent (it would loop, or go too deep, or the parent is gone); null when it is fine. `id` is the category being
 * moved, absent for a new one. */
export async function parentProblem(id: string | null, parentId: string): Promise<string | null> {
  const rows = await db.select({ id: categories.id, name: categories.name, slug: categories.slug, parentId: categories.parentId, sortOrder: categories.sortOrder }).from(categories);
  if (!rows.some((row) => row.id === parentId)) return "The parent category was not found.";
  if (id && wouldLoop(rows.map(nodeOf), id, parentId)) return "A category cannot be moved inside itself or inside one of its own categories.";
  if (ancestry(rows.map(nodeOf), parentId).length + 1 + (id ? subtreeHeight(rows.map(nodeOf), id) : 0) > MAX_DEPTH) return `Categories can be at most ${MAX_DEPTH} levels deep.`;
  return null;
}

/** "Shirts > Formal" for the category with this id (used to show the owner what to write). */
function ancestryPath(rows: CategoryRow[], id: string): string {
  return ancestry(rows.map(nodeOf), id).map((node) => node.name).join(" > ");
}

const nodeOf = (row: { id: string; name: string; slug: string; parentId: string | null; sortOrder: number }): TreeNode => row;

/** Levels below a category (0 when it has nothing inside). */
function subtreeHeight(nodes: TreeNode[], id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0; // a loop in bad data must not run forever
  seen.add(id);
  const below = nodes.filter((node) => node.parentId === id);
  return below.length ? 1 + Math.max(...below.map((node) => subtreeHeight(nodes, node.id, seen))) : 0;
}

const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

/**
 * The category with this name (capital letters ignored), created on the spot when it does not exist yet. Used by the Excel import and the product
 * form, so typing a new category name simply makes it. A category can be written as a path ("Shirts > Formal Shirts > Business Formal Shirts"): every
 * level is found or created inside the one before it, and the last one is returned. A plain name matches a category anywhere in the tree (a top-level
 * one first); when there is none, a new top-level category is made. New categories go to the end of their list and are active.
 */
export async function ensureCategory(rawName: string): Promise<{ id: string; name: string }> {
  const parts = splitCategoryPath(rawName);
  if (!parts.length) throw new CategoryInputError("Category name is empty.");
  if (parts.length > MAX_DEPTH) throw new CategoryInputError(`A category can be at most ${MAX_DEPTH} levels deep.`);
  const load = () => db.select({ id: categories.id, name: categories.name, slug: categories.slug, parentId: categories.parentId, sortOrder: categories.sortOrder }).from(categories);
  // A shop has a handful of categories: reading them all is cheaper and safer than a pattern search.
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  if (parts.length === 1) {
    const rows = await load();
    const matches = rows.filter((row) => same(row.name, parts[0]));
    const existing = matches.find((row) => !row.parentId) ?? matches[0];
    // the same name in two places inside the tree: guessing would put the product in the wrong one
    if (existing?.parentId && matches.length > 1) throw new CategoryInputError(`"${parts[0]}" is the name of more than one category. Write the whole path, for example ${ancestryPath(rows, matches[0].id)}.`);
    if (existing) return { id: existing.id, name: existing.name };
  }

  let parentId: string | null = null;
  let last = { id: "", name: "" };
  for (const name of parts) {
    last = await findOrCreateChild(load, parentId, name, same);
    parentId = last.id;
  }
  return last;
}

type CategoryRow = { id: string; name: string; slug: string; parentId: string | null; sortOrder: number };

async function findOrCreateChild(
  load: () => Promise<CategoryRow[]>,
  parentId: string | null,
  name: string,
  same: (a: string, b: string) => boolean,
): Promise<{ id: string; name: string }> {
  const find = (rows: CategoryRow[]) => rows.find((row) => (row.parentId ?? null) === parentId && same(row.name, name));
  const rows = await load();
  const existing = find(rows);
  if (existing) return { id: existing.id, name: existing.name };

  const siblings = rows.filter((row) => (row.parentId ?? null) === parentId);
  const sortOrder = siblings.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
  const parent = parentId ? rows.find((row) => row.id === parentId) : undefined;
  // The address of a category is its slug, which is unique across the shop: a name used before gets its parent's name in front, then a number.
  const taken = new Set(rows.map((row) => row.slug));
  const base = slugify(name) || "category";
  const stem = parent ? `${parent.slug}-${base}` : base;
  const candidates = [base, stem];
  for (let n = 2; n < 60; n++) candidates.push(`${stem}-${n}`);
  for (const slug of candidates.filter((candidate) => !taken.has(candidate)).slice(0, 5)) {
    try {
      const [created] = await db
        .insert(categories)
        .values({ name, slug, parentId, status: "active", sortOrder })
        .returning({ id: categories.id, name: categories.name });
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const again = find(await load()); // somebody made it at the same moment
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
