import { z } from "zod";

const visibilityEnum = z.enum(["draft", "published", "archived"]);

const dimensionsSchema = z.object({
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  unit: z.string().optional(),
});

const attributesSchema = z.object({
  pattern: z.string().optional(),
  style: z.union([z.string(), z.array(z.string())]).optional(),
  occasion: z.union([z.string(), z.array(z.string())]).optional(),
  gender: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  googleProductCategory: z.string().optional(),
});

const seoSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  // Meta keywords have no effect on modern search ranking (Google has ignored the tag for over a
  // decade) — accepted here only so the field doesn't fail validation if included, never used.
  keywords: z.array(z.string()).optional(),
});

/** `file` is a plain filename (e.g. "nomad-desert.jpg") — shown back to the admin in the
 * create-product drawer as a hint for which photo to pick for that variant (browsers can't read a
 * local file by name, so it can't be matched automatically). Nothing here is a URL: images are
 * never fetched by the server, only ever processed in the browser (same pipeline as a manual
 * upload), so large originals never hit the Worker. */
const imageRefSchema = z.object({
  file: z.string().min(1),
  isPrimary: z.boolean().optional(),
  order: z.coerce.number().int().min(0).optional(),
  alt: z.string().optional(),
});

const importVariantSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1),
  sku: z.string().min(1),
  size: z.string().optional(),
  fabric: z.string().optional(),
  gtin: z.string().optional(),
  price: z.coerce.number().int().min(0),
  compareAtPrice: z.coerce.number().int().min(0).optional(),
  stockQuantity: z.coerce.number().int().min(0).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  isDefault: z.boolean().optional(),
  images: z.array(imageRefSchema).optional(),
});

/** One product per JSON object. Always has a `variants` array (min 1) — a single-variant product
 * is simply a `variants` array with one entry. `category` is matched against an existing category
 * name (case-insensitive); it is not created automatically. */
export const productImportSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  category: z.string().min(1),
  typeLabel: z.string().min(1),
  subcategory: z.string().max(60).refine((value) => !value.includes(","), "Subcategory cannot contain a comma.").optional(),
  comingSoon: z.boolean().optional(),
  visibility: visibilityEnum.optional(),
  featured: z.boolean().optional(),
  badge: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  material: z.string().optional(),
  dimensions: dimensionsSchema.optional(),
  careInstructions: z.union([z.string(), z.array(z.string())]).optional(),
  primaryColour: z.string().optional(),
  attributes: attributesSchema.optional(),
  seo: seoSchema.optional(),
  variants: z.array(importVariantSchema).min(1),
});

export type ProductImport = z.infer<typeof productImportSchema>;
export type ProductImportVariant = z.infer<typeof importVariantSchema>;

export const productImportBatchSchema = z.union([productImportSchema, z.object({ products: z.array(productImportSchema).min(1) })]);

const GENDER_MAP: Record<string, "female" | "male" | "unisex"> = {
  female: "female",
  women: "female",
  woman: "female",
  w: "female",
  male: "male",
  men: "male",
  man: "male",
  m: "male",
};

export function normalizeGender(input: string | undefined): "female" | "male" | "unisex" {
  return GENDER_MAP[(input ?? "").trim().toLowerCase()] ?? "unisex";
}

export function joinListField(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(", ") || undefined : value || undefined;
}

export function formatDimensions(dimensions: z.infer<typeof dimensionsSchema> | undefined): string | undefined {
  if (!dimensions) return undefined;
  const { length, width, height, unit = "cm" } = dimensions;
  const parts = [length, width, height].filter((n): n is number => typeof n === "number");
  if (!parts.length) return undefined;
  return `${parts.join(" × ")} ${unit}`.trim();
}

export function joinCareInstructions(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(" ") || undefined : value || undefined;
}
