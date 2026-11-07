// Turning rows an AI assistant wrote (objects with the sheet's column names) into what the Excel upload works with, and the products into the importer's JSON.
// Pure functions, no database: the unit tests run them directly, and lib/import/create-from-sheet.ts does the saving.

import { categoryPathOf, parseProductTable, SHEET_COLUMNS, type ParsedProduct, type ParsedSheet } from "@/lib/product-sheet";
import type { ProductImport } from "@/lib/import/product-import-schema";

/** The most rows and the most products one call may carry. */
export const MAX_ROWS = 300;
export const MAX_PRODUCTS = 25;

const norm = (text: unknown) => String(text ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[*:_\-./?]/g, " ").replace(/\s+/g, " ").trim();

/** Every spelling of a column an assistant may use (the key, the title in the sheet, or one of the titles the importer knows), in the same plain form. */
const COLUMN_BY_NAME = new Map<string, string>();
for (const column of SHEET_COLUMNS) for (const name of [column.key, column.label, ...column.aliases]) COLUMN_BY_NAME.set(norm(name), column.key);

/** What an assistant may write in a cell: text, a number, yes/no, or a list (sizes, prices, photos), which is written the way the sheet does it, with commas. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => cellText(item)).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export type RowsToTable = { table: unknown[][]; problems: string[] };

/**
 * The rows as the sheet's table (titles in the first row), so the very same reader checks them as for an uploaded file. A column name the sheet does not have is a problem
 * (a misspelt “prise” must not quietly become an empty price).
 */
export function rowsToTable(rows: unknown[]): RowsToTable {
  const problems: string[] = [];
  const header = SHEET_COLUMNS.map((column) => column.label);
  const index = new Map(SHEET_COLUMNS.map((column, i) => [column.key, i]));
  const table: unknown[][] = [header];
  rows.forEach((row, n) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      problems.push(`Row ${n + 1} must be an object with the sheet's columns, for example {"name": "…", "category": "…"}.`);
      return;
    }
    const cells: unknown[] = SHEET_COLUMNS.map(() => "");
    const unknown: string[] = [];
    for (const [name, value] of Object.entries(row as Record<string, unknown>)) {
      const key = COLUMN_BY_NAME.get(norm(name));
      if (key === undefined) unknown.push(name);
      else cells[index.get(key) as number] = cellText(value);
    }
    if (unknown.length) problems.push(`Row ${n + 1} has ${unknown.length > 1 ? "columns" : "a column"} the sheet does not know: ${unknown.map((name) => `“${name}”`).join(", ")}. The columns are ${SHEET_COLUMNS.map((column) => column.key).join(", ")}.`);
    table.push(cells);
  });
  return { table, problems };
}

/** One product on the shop: all the colours that share a name and category (the sheet has a row for each colour, and the shop shows them on one page). */
export type ColourGroup = { key: string; first: ParsedProduct; colours: ParsedProduct[] };

/** Joins the colours of one product, as the upload screen does just before it saves. */
export function groupColours(products: ParsedProduct[]): ColourGroup[] {
  const groups: ColourGroup[] = [];
  for (const entry of products) {
    const key = `${entry.name.toLowerCase()}|${entry.category.toLowerCase()}`;
    const found = groups.find((group) => group.key === key);
    if (found) found.colours.push(entry);
    else groups.push({ key, first: entry, colours: [entry] });
  }
  return groups;
}

/**
 * The importer's JSON for one product. It is always saved as a DRAFT (hidden): the pictures come next, then the owner publishes. Every picture the sheet promised is listed,
 * whether or not the file is there yet; the importer answers with where each one goes.
 */
export function importPayload(group: ColourGroup): ProductImport {
  const { first: product, colours } = group;
  return {
    name: product.name,
    category: categoryPathOf(product),
    typeLabel: product.type,
    subcategory: colours.map((entry) => entry.subcategory).find(Boolean) || undefined,
    comingSoon: product.comingSoon || undefined,
    visibility: "draft",
    badge: product.label || undefined,
    description: product.description || undefined,
    material: product.fabric || undefined,
    primaryColour: product.colour,
    variants: colours.flatMap((colour, colourIndex) =>
      colour.variants.map((variant, i) => ({
        name: `${colour.colour}${variant.size ? ` / ${variant.size}` : ""}`,
        color: colour.colour,
        sku: variant.sku,
        size: variant.size || undefined,
        price: variant.price,
        compareAtPrice: variant.oldPrice ?? undefined,
        stockQuantity: variant.stock,
        isDefault: colourIndex === 0 && i === 0,
        images:
          i === 0
            ? colour.photos.map((file, order) => ({ file, isPrimary: colourIndex === 0 && order === 0, order, alt: `${product.name}${colours.length > 1 ? ` — ${colour.colour}` : ""}${order ? ` — photo ${order + 1}` : ""}` }))
            : undefined,
      })),
    ),
  } as ProductImport;
}

/** A short code of exactly what was previewed: the same rows give the same code, any change gives another. The assistant must hand it back to create the products, so what is created is what was shown. */
export async function digestOf(products: ParsedProduct[]): Promise<string> {
  const plain = products.map((p) => ({ n: p.name, c: categoryPathOf(p), t: p.type, k: p.colour, d: p.description, f: p.fabric, v: p.visible, s: p.comingSoon, l: p.label, ph: p.photos, vs: p.variants.map((v) => [v.size, v.sku, v.price, v.oldPrice, v.stock]) }));
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(plain)));
  return [...new Uint8Array(bytes)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type Preview = {
  products: Array<{
    name: string;
    category: string;
    type: string;
    description: string | null;
    willShowOnWebsite: boolean;
    colours: Array<{ colour: string; photosToAdd: string[]; sizes: Array<{ size: string; price: number; oldPrice: number | null; stock: number; code: string }> }>;
  }>;
  totals: { products: number; colours: number; sizes: number; pictures: number };
};

/** What the shop will get, in the order and words of the sheet: one entry for each product page, with its colours and the price, stock and code of every size. */
export function previewOf(products: ParsedProduct[]): Preview {
  const groups = groupColours(products);
  const out: Preview["products"] = groups.map(({ first, colours }) => ({
    name: first.name,
    category: categoryPathOf(first),
    type: first.type,
    description: first.description ? first.description.slice(0, 300) : null,
    willShowOnWebsite: first.visible && !first.comingSoon,
    colours: colours.map((colour) => ({
      colour: colour.colour,
      photosToAdd: colour.photos,
      sizes: colour.variants.map((variant) => ({ size: variant.size || "(no size)", price: variant.price, oldPrice: variant.oldPrice, stock: variant.stock, code: variant.sku })),
    })),
  }));
  return {
    products: out,
    totals: {
      products: out.length,
      colours: out.reduce((sum, product) => sum + product.colours.length, 0),
      sizes: out.reduce((sum, product) => sum + product.colours.reduce((n, colour) => n + colour.sizes.length, 0), 0),
      pictures: out.reduce((sum, product) => sum + product.colours.reduce((n, colour) => n + colour.photosToAdd.length, 0), 0),
    },
  };
}

/** Reads the rows with the sheet's own reader. */
export function readRows(rows: unknown[]): { parsed: ParsedSheet; problems: string[] } {
  const { table, problems } = rowsToTable(rows);
  const parsed = parseProductTable(table);
  return { parsed, problems: [...problems, ...parsed.problems.map((problem) => `Row ${problem.row - 1}: ${problem.message}`)] };
}
