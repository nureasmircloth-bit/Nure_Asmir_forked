// What the management tools accept: pure data (no database), so the unit tests can check the limits and the checks on the arguments.

/** The most changes (or products to delete) one call may carry; the preview and the confirmation cover exactly these. */
export const MAX_CHANGES = 100;

const CHANGES_HELP =
  "A list (at most " + MAX_CHANGES + ") of changes, each an object of ONE of three kinds. " +
  "(1) About a product page: {product: \"its slug or exact name\", and any of status (published|draft|archived: published shows it on the website, draft hides it, archived hides it and keeps it), category, subcategory, badge (New, Sale, Bestseller, Limited or \"\"), featured, priceOnRequest, comingSoon, seoTitle, seoDescription, seoKeywords, regenerateSeo (true: write the search-engine text again)}. " +
  "(2) About one size: {sku: \"the size's product code\", and any of price, oldPrice (null removes it), stock, remove (true hides that size)}. " +
  "(3) New sizes: {product: \"slug or exact name\", addSizes: \"S, M, L\", price, stock, optional colour (all colours when left out), optional oldPrice}.";

/** The arguments of prepare_changes. */
export const CHANGES_INPUT = { type: "object", properties: { changes: { type: "array", items: { type: "object" }, maxItems: MAX_CHANGES, description: CHANGES_HELP } }, required: ["changes"], additionalProperties: false } as const;
/** The arguments of apply_changes. */
export const APPLY_INPUT = {
  type: "object",
  properties: { changes: { type: "array", items: { type: "object" }, maxItems: MAX_CHANGES, description: CHANGES_HELP }, confirm: { type: "string", description: "The confirmation prepare_changes gave for these exact changes (it is used up by one apply_changes call)." } },
  required: ["changes", "confirm"],
  additionalProperties: false,
} as const;
const NAMES_HELP = "The products to delete, each as its slug or exact name (at most " + MAX_CHANGES + "). Only products that are NOT on the website (draft or archived) can be deleted.";
/** The arguments of prepare_delete and delete_products. */
export const DELETE_PREPARE_INPUT = { type: "object", properties: { products: { type: "array", items: { type: "string" }, maxItems: MAX_CHANGES, description: NAMES_HELP } }, required: ["products"], additionalProperties: false } as const;
export const DELETE_INPUT = { type: "object", properties: { products: { type: "array", items: { type: "string" }, maxItems: MAX_CHANGES, description: NAMES_HELP }, confirm: { type: "string", description: "The confirmation prepare_delete gave for exactly these products." } }, required: ["products", "confirm"], additionalProperties: false } as const;
/** The arguments of refresh_website. */
export const REFRESH_INPUT = { type: "object", properties: { products: { type: "array", items: { type: "string" }, maxItems: MAX_CHANGES, description: "Products (slug or exact name) whose search entry to rebuild. Leave out to rebuild the whole search." } }, additionalProperties: false } as const;
/** The arguments of seo_report. */
export const SEO_REPORT_INPUT = { type: "object", properties: { page: { type: "integer", minimum: 1, maximum: 1000, description: "Which page of 50 products. Default 1." } }, additionalProperties: false } as const;
