// Reading a product sheet (Excel or Google Sheets exported as .xlsx / .csv) into products. Pure functions only
// – no Excel library, no network – so it runs in the browser, in the e2e unit tests and in the server alike.
//
// The sheet has ONE ROW PER SIZE. Rows that share the same product name and colour become one colour with
// several sizes; the importer then joins colours that share a product name into one product. Every complaint is phrased for a shop owner and names the row number as Excel shows it.

import { suggestSku } from "./sku";

export type SheetColumn = { key: string; label: string; required?: boolean; width: number; help: string; aliases: string[] };

export const SHEET_COLUMNS: SheetColumn[] = [
  { key: "name", label: "Product name*", required: true, width: 30, help: "The name customers see, e.g. Olive Cargo Pants. Use the same name on every size row.", aliases: ["product name", "name", "title", "item", "item name"] },
  { key: "category", label: "Category*", required: true, width: 20, help: "Pick from the list, e.g. Shirts. A new name creates a new category.", aliases: ["category", "collection", "group"] },
  { key: "subcategory", label: "Subcategory (optional)", width: 20, help: "Optional, e.g. Casual or Embroidered. It is added to the category's list of subcategories if it is new; the shop shows it as a chip on the category page.", aliases: ["subcategory", "sub category", "sub-category", "subcategories"] },
  { key: "type", label: "What is it?*", required: true, width: 18, help: "Pick or type: Shirt, Pants, Shalwar Kameez, Wallet…", aliases: ["what is it", "type", "product type", "kind"] },
  { key: "colour", label: "Colour*", required: true, width: 14, help: "One colour on each row. The same shirt in another colour? Use the same product name and a different colour — we put them together on one page.", aliases: ["colour", "color"] },
  { key: "size", label: "Size", width: 12, help: "S, M, L, XL, 32, 34… or One size. Leave empty if it has no sizes.", aliases: ["size", "sizes"] },
  { key: "price", label: "Price (PKR)*", required: true, width: 14, help: "Selling price in rupees, numbers only, e.g. 5500.", aliases: ["price", "price pkr", "selling price", "sale price", "rs"] },
  { key: "oldPrice", label: "Old price (optional)", width: 18, help: "Only if this item is on discount. Must be higher than the price.", aliases: ["old price", "compare at price", "compare price", "was price", "mrp", "cut price"] },
  { key: "stock", label: "Stock*", required: true, width: 10, help: "How many you have right now, e.g. 12.", aliases: ["stock", "quantity", "qty", "in stock", "inventory"] },
  { key: "code", label: "Product code (optional)", width: 22, help: "Leave empty — we make one for you. Every size needs a different code.", aliases: ["product code", "code", "sku"] },
  { key: "fabric", label: "Fabric (optional)", width: 18, help: "e.g. Cotton, Wash & Wear, Leather.", aliases: ["fabric", "material"] },
  { key: "description", label: "Description (optional)", width: 40, help: "A few sentences for the product page. Leave empty and we write one later if you ask.", aliases: ["description", "details", "about"] },
  { key: "show", label: "Show on website? (Yes/No)", width: 16, help: "Yes = customers can see it now. No = hidden until you are ready.", aliases: ["show on website", "show", "visible", "publish", "published", "status"] },
  { key: "photos", label: "Photo file names (optional)", width: 30, help: "The names of the pictures for this product, separated by commas, e.g. cargo-1.jpg, cargo-2.jpg. You add the pictures in the next step.", aliases: ["photo file names", "photos", "images", "image", "photo", "pictures"] },
  { key: "comingSoon", label: "Coming soon? (Yes/No, optional)", width: 16, help: "Yes = the product is shown with its name, picture and a \"Coming soon\" badge but cannot be bought yet. Price and stock may then stay empty.", aliases: ["coming soon", "coming soon yes no", "soon", "upcoming"] },
  { key: "label", label: "Small label (optional)", width: 14, help: "New, Sale, Bestseller or Limited.", aliases: ["small label", "label", "badge", "tag"] },
];

export type ParsedVariant = { row: number; size: string; sku: string; skuGiven: boolean; price: number; oldPrice: number | null; stock: number };
export type ParsedProduct = {
  key: string;
  row: number;
  name: string;
  category: string;
  subcategory: string;
  type: string;
  colour: string;
  fabric: string;
  description: string;
  visible: boolean;
  comingSoon: boolean;
  label: string;
  photos: string[];
  variants: ParsedVariant[];
};
export type SheetProblem = { row: number; message: string };
export type ParsedSheet = { products: ParsedProduct[]; problems: SheetProblem[]; rowCount: number };

const norm = (text: unknown) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[*:_\-./?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Rs. 5,500/-" → 5500. Returns null for anything that is not a plain number. */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const text = String(value ?? "")
    .replace(/pkr|rs\.?|rupees?|\/-/gi, "")
    .replace(/[,\s]/g, "");
  if (!text) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Math.round(Number(text));
}

export function parseYesNo(value: unknown, fallback: boolean): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["yes", "y", "true", "1", "show", "published", "on", "haan", "han", "ji"].includes(text)) return true;
  if (["no", "n", "false", "0", "hide", "hidden", "draft", "off", "nahi", "nahin"].includes(text)) return false;
  return fallback;
}

export function normalizeSize(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^(one|free|std|standard)\s*size$/i.test(text) || /^os$/i.test(text)) return "One size";
  return text.toUpperCase() === text || /^\d/.test(text) ? text.toUpperCase() : text;
}

const LABELS = ["new", "sale", "bestseller", "limited"];
function normalizeLabel(value: unknown): string {
  const text = String(value ?? "").trim();
  const hit = LABELS.find((label) => label === text.toLowerCase());
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : "";
}

/** Finds the header row (the first row that mentions a name and a price) and maps each column to a field. */
export function mapColumns(table: unknown[][]): { headerIndex: number; columns: Map<string, number> } | null {
  for (let r = 0; r < Math.min(table.length, 15); r++) {
    const columns = new Map<string, number>();
    table[r].forEach((cell, index) => {
      const text = norm(cell);
      if (!text) return;
      const column = SHEET_COLUMNS.find((col) => col.aliases.includes(text) || norm(col.label) === text);
      if (column && !columns.has(column.key)) columns.set(column.key, index);
    });
    if (columns.has("name") && columns.has("price")) return { headerIndex: r, columns };
  }
  return null;
}

/**
 * Turns the cells of a sheet into products. `existingCategories` are the category names already in the shop
 * (case-insensitive) – unknown names are reported as `newCategories` by the caller, not as errors.
 */
export function parseProductTable(table: unknown[][]): ParsedSheet {
  const mapped = mapColumns(table);
  if (!mapped) {
    return {
      products: [],
      rowCount: 0,
      problems: [{ row: 1, message: "We could not find the column titles. Please use our sheet (Download the sheet), and keep the first row with the titles — “Product name”, “Price” and the others." }],
    };
  }
  const { headerIndex, columns } = mapped;
  const cell = (row: unknown[], key: string) => {
    const index = columns.get(key);
    return index === undefined ? "" : row[index];
  };

  const problems: SheetProblem[] = [];
  const groups = new Map<string, ParsedProduct>();
  let rowCount = 0;

  for (let r = headerIndex + 1; r < table.length; r++) {
    const row = table[r] ?? [];
    if (row.every((value) => String(value ?? "").trim() === "")) continue;
    const excelRow = r + 1;
    rowCount += 1;

    const name = String(cell(row, "name") ?? "").trim().replace(/\s+/g, " ");
    const colour = String(cell(row, "colour") ?? "").trim();
    const before = problems.length;
    const fail = (message: string) => problems.push({ row: excelRow, message });

    if (!name) fail("The product name is empty. Type the name on every row (copy it down).");
    const category = String(cell(row, "category") ?? "").trim();
    const type = String(cell(row, "type") ?? "").trim();
    if (!category) fail("Category is empty.");
    if (!type) fail("“What is it?” is empty (for example Shirt or Pants).");
    if (!colour) fail("Colour is empty.");
    if (String(cell(row, "subcategory") ?? "").includes(",")) fail("Subcategory cannot contain a comma (one subcategory per product).");

    const soon = parseYesNo(cell(row, "comingSoon"), false);
    // A "coming soon" product may have no price or stock yet: it cannot be bought anyway.
    const priceText = String(cell(row, "price") ?? "").trim();
    const price = soon && priceText === "" ? 0 : parseMoney(cell(row, "price"));
    if (price === null || (!soon && price < 1)) fail(`Price “${String(cell(row, "price") ?? "")}” is not a number. Type it like 5500.`);
    const stockText = String(cell(row, "stock") ?? "").trim();
    const stock = stockText === "" ? 0 : parseMoney(cell(row, "stock"));
    if (stock === null || stock < 0) fail(`Stock “${stockText}” is not a number. Type it like 12.`);
    const oldRaw = cell(row, "oldPrice");
    const oldPrice = String(oldRaw ?? "").trim() === "" ? null : parseMoney(oldRaw);
    if (String(oldRaw ?? "").trim() !== "" && oldPrice === null) fail(`Old price “${String(oldRaw)}” is not a number.`);
    if (oldPrice !== null && price !== null && oldPrice <= price) fail("The old price must be higher than the price (or leave it empty).");

    if (problems.length > before) continue;

    const size = normalizeSize(cell(row, "size"));
    const given = String(cell(row, "code") ?? "").trim().toUpperCase().replace(/\s+/g, "");
    const key = `${name.toLowerCase()}|${colour.toLowerCase()}`;
    let product = groups.get(key);
    if (!product) {
      product = {
        key,
        row: excelRow,
        name,
        category,
        subcategory: String(cell(row, "subcategory") ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
        type,
        colour,
        fabric: String(cell(row, "fabric") ?? "").trim(),
        description: String(cell(row, "description") ?? "").trim(),
        visible: parseYesNo(cell(row, "show"), true),
        comingSoon: soon,
        label: normalizeLabel(cell(row, "label")),
        photos: [],
        variants: [],
      };
      groups.set(key, product);
    }
    // Later rows may fill in details the first row left empty.
    product.fabric ||= String(cell(row, "fabric") ?? "").trim();
    product.description ||= String(cell(row, "description") ?? "").trim();
    product.subcategory ||= String(cell(row, "subcategory") ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    for (const file of String(cell(row, "photos") ?? "").split(/[,;\n]/).map((f) => f.trim()).filter(Boolean)) {
      if (!product.photos.some((p) => p.toLowerCase() === file.toLowerCase())) product.photos.push(file);
    }
    if (product.variants.some((v) => v.size.toLowerCase() === size.toLowerCase())) {
      fail(`Size “${size || "(none)"}” of ${name} is listed twice.`);
      continue;
    }
    product.variants.push({ row: excelRow, size, sku: given || suggestSku(name, type, size), skuGiven: Boolean(given), price: price as number, oldPrice, stock: stock as number });
  }

  // Product codes must be different everywhere in the sheet.
  const seen = new Map<string, number>();
  for (const product of groups.values()) {
    for (const variant of product.variants) {
      const code = variant.sku.toLowerCase();
      if (seen.has(code)) problems.push({ row: variant.row, message: `The product code ${variant.sku} is already used on row ${seen.get(code)}. Change one of them.` });
      else seen.set(code, variant.row);
    }
  }
  if (!rowCount) problems.push({ row: headerIndex + 2, message: "The sheet has no products yet. Fill in the rows under the titles." });
  return { products: [...groups.values()], problems, rowCount };
}

/** Minimal CSV reader (quotes, commas inside quotes, CRLF, BOM) – for sheets saved from Google Sheets as .csv. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Stock/price update sheet: one row per product code. */
export type UpdateRow = { row: number; sku: string; price: number | null; stock: number | null; oldPrice: number | null | undefined };

export function parseUpdateTable(table: unknown[][]): { rows: UpdateRow[]; problems: SheetProblem[] } {
  const problems: SheetProblem[] = [];
  const rows: UpdateRow[] = [];
  let header = -1;
  let cols = { sku: -1, price: -1, stock: -1, old: -1 };
  for (let r = 0; r < Math.min(table.length, 15); r++) {
    const names = (table[r] ?? []).map(norm);
    const sku = names.findIndex((n) => ["product code", "code", "sku"].includes(n));
    if (sku >= 0) {
      header = r;
      cols = {
        sku,
        price: names.findIndex((n) => ["price", "price pkr", "new price"].includes(n)),
        stock: names.findIndex((n) => ["in stock", "stock", "quantity", "new stock"].includes(n)),
        old: names.findIndex((n) => ["old price", "compare at price"].includes(n)),
      };
      break;
    }
  }
  if (header < 0) return { rows, problems: [{ row: 1, message: "We could not find the “Product code” column. Please use the sheet you downloaded from the Update page." }] };
  const seen = new Set<string>();
  for (let r = header + 1; r < table.length; r++) {
    const line = table[r] ?? [];
    const sku = String(line[cols.sku] ?? "").trim();
    if (!sku) continue;
    const excelRow = r + 1;
    const price = cols.price >= 0 && String(line[cols.price] ?? "").trim() !== "" ? parseMoney(line[cols.price]) : null;
    const stock = cols.stock >= 0 && String(line[cols.stock] ?? "").trim() !== "" ? parseMoney(line[cols.stock]) : null;
    if (cols.price >= 0 && String(line[cols.price] ?? "").trim() !== "" && (price === null || price < 1)) {
      problems.push({ row: excelRow, message: `Price “${String(line[cols.price])}” is not a number.` });
      continue;
    }
    if (cols.stock >= 0 && String(line[cols.stock] ?? "").trim() !== "" && (stock === null || stock < 0)) {
      problems.push({ row: excelRow, message: `Stock “${String(line[cols.stock])}” is not a number.` });
      continue;
    }
    if (seen.has(sku.toLowerCase())) {
      problems.push({ row: excelRow, message: `The product code ${sku} appears twice.` });
      continue;
    }
    seen.add(sku.toLowerCase());
    const oldRaw = cols.old >= 0 ? String(line[cols.old] ?? "").trim() : undefined;
    rows.push({ row: excelRow, sku, price, stock, oldPrice: oldRaw === undefined ? undefined : oldRaw === "" ? null : parseMoney(oldRaw) });
  }
  if (!rows.length && !problems.length) problems.push({ row: header + 2, message: "No rows to update were found." });
  return { rows, problems };
}
