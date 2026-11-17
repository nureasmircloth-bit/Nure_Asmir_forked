// The few fields of a product or a size that matter when reading its history (and when undoing a change by hand). Plain data, no database.

type Loose = Record<string, unknown>;

/** What a product page looks like in the history: the fields the owner can change. */
export function productSnapshot(row: Loose): Loose {
  const keys = ["name", "slug", "categoryId", "subcategory", "status", "typeLabel", "shortDescription", "description", "material", "badge", "featured", "priceOnRequest", "comingSoon", "seoTitle", "seoDescription", "seoKeywords", "seoLocked", "primaryColour", "gender"];
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key] ?? null]));
}

/** What a size looks like in the history. */
export function variantSnapshot(row: Loose): Loose {
  const keys = ["sku", "color", "size", "price", "compareAtPrice", "stockQuantity", "status", "isDefault"];
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key] ?? null]));
}

/** The fields that differ between two snapshots, as {field, before, after}. */
export function changedFields(before: Loose | null, after: Loose | null): Array<{ field: string; before: unknown; after: unknown }> {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)).map((key) => ({ field: key, before: before?.[key] ?? null, after: after?.[key] ?? null }));
}
