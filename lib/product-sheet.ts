// Reading a product sheet (Excel or Google Sheets exported as .xlsx / .csv) into products. Pure functions only
// – no Excel library, no network – so it runs in the browser, in the e2e unit tests and in the server alike.
//
// One row can list several sizes ("14.5, 15, 15.5") or each size can have its own row. Rows that share the same product name
// and colour become one colour with several sizes; the importer then joins colours that share a product name into one product. Every complaint is phrased for a shop owner and names the row number as Excel shows it.

import { suggestSku } from "./sku";

export type SheetColumn = { key: string; label: string; required?: boolean; width: number; help: string; aliases: string[] };

export const SHEET_COLUMNS: SheetColumn[] = [
  { key: "name", label: "Product name*", required: true, width: 30, help: "The name customers see, e.g. Olive Cargo Pants. Use the same name on every size row.", aliases: ["product name", "name", "title", "item", "item name"] },
  { key: "category", label: "Category*", required: true, width: 20, help: "Pick from the list, e.g. Shirts. For a category inside another, write the path with > between the names, e.g. Shirts > Formal Shirts > Business Formal Shirts. A new name creates a new category.", aliases: ["category", "collection", "group"] },
  { key: "subcategory", label: "Subcategory (optional)", width: 20, help: "Optional, the category inside the Category, e.g. Formal Shirts inside Shirts. A new name makes a new folder; the product goes inside it (or inside the Sub-subcategory when that is filled).", aliases: ["subcategory", "sub category", "sub-category", "subcategories"] },
  { key: "sub2", label: "Sub-subcategory (optional)", width: 22, help: "Optional, the category inside the Subcategory, e.g. Business Formal Shirts inside Formal Shirts. Needs the Subcategory to be filled first.", aliases: ["sub subcategory", "sub-subcategory", "subsubcategory", "sub sub category", "level 3", "third category"] },
  { key: "sub3", label: "Level 4 (optional)", width: 18, help: "Optional, one more level inside the Sub-subcategory. Needs the Sub-subcategory first.", aliases: ["level 4", "fourth category"] },
  { key: "type", label: "What is it?*", required: true, width: 18, help: "Pick or type: Shirt, Pants, Shalwar Kameez, Wallet…", aliases: ["what is it", "type", "product type", "kind"] },
  { key: "colour", label: "Colour*", required: true, width: 14, help: "One colour on each row. The same shirt in another colour? Use the same product name and a different colour — we put them together on one page.", aliases: ["colour", "color"] },
  { key: "size", label: "Size", width: 12, help: "S, M, L, XL, 32, 34… or One size. Several sizes of the same colour can go in one cell, separated by commas: 14.5, 15, 15.5, 16. Leave empty if it has no sizes.", aliases: ["size", "sizes"] },
  { key: "price", label: "Price (PKR)*", required: true, width: 14, help: "Selling price in rupees, numbers only, e.g. 5500. When the sizes have different prices, type one price for each size in the same order, with a comma and a space: 5800, 5800, 6200, 6200.", aliases: ["price", "price pkr", "selling price", "sale price", "rs"] },
  { key: "oldPrice", label: "Old price (optional)", width: 18, help: "Only if this item is on discount. Must be higher than the price. Like the price, it can be one number for all sizes or one for each size.", aliases: ["old price", "compare at price", "compare price", "was price", "mrp", "cut price"] },
  { key: "stock", label: "Stock*", required: true, width: 10, help: "How many you have right now, e.g. 12. With several sizes in one row: one number for all of them (3), or one number for each size in the same order (3, 5, 2, 1).", aliases: ["stock", "quantity", "qty", "in stock", "inventory"] },
  { key: "code", label: "Product code (optional)", width: 22, help: "Leave empty — we make one for you (it includes the colour when the product comes in several). Or type one code for the whole product (FOR-132) on every size row: each size then gets its own, like FOR-132-14.5. Different products need different codes.", aliases: ["product code", "code", "sku"] },
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
  /** The categories inside the subcategory (level 3, level 4). */
  deeper: string[];
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

/** "14.5, 15; 15.5" → ["14.5", "15", "15.5"] (commas, semicolons and line breaks separate the items). */
export function splitList(value: unknown): string[] {
  return String(value ?? "")
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export type Spread = { cells: string[] } | { error: "count" | "ambiguous"; found: number };

/**
 * A cell that holds one value for every size ("3", "6800") or one value for each size ("3, 5, 2" – in the order of the sizes).
 * Gives one text for each size, or says why it cannot: the wrong number of values ("count"), or a number like 1,000 that could be one amount or a list of two ("ambiguous").
 * Empty places count: "14000, , 15000" has no old price for the second size, and "6000," is a price for the first size and nothing for the second.
 * With a single size the whole cell is the value, so "1,000" is a thousand.
 * `kind`: "price" reads "6,500" (a comma followed by exactly three digits, no space) as one amount, since a price list of numbers under a thousand does not occur;
 * "stock" refuses to guess when "1,000" could also be a list for that many sizes, and asks to be written as 1000 (or "100, 200" with a space).
 */
export function spreadList(value: unknown, count: number, kind: "price" | "stock" = "stock"): Spread {
  const whole = String(value ?? "").trim();
  if (count <= 1) return { cells: [whole] };
  const single = { cells: Array.from({ length: count }, () => whole) };
  const parts = whole.split(/[,;\n]/).map((part) => part.trim());
  if (parts.length === 1) return single;
  const oneAmount = /^(rs\.?\s*|pkr\s*)?\d{1,3}(,\d{3})+(\.\d+)?(\/-)?$/i.test(whole);
  if (oneAmount) {
    if (kind === "price") return single;
    return parts.length === count ? { error: "ambiguous", found: parts.length } : single;
  }
  return parts.length === count ? { cells: parts } : { error: "count", found: parts.length };
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
    const tidy = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    const deeper = [tidy(cell(row, "sub2")), tidy(cell(row, "sub3"))];
    if (deeper[0] && !tidy(cell(row, "subcategory"))) fail("Sub-subcategory is filled but Subcategory is empty. Fill the Subcategory first.");
    if (deeper[1] && !deeper[0]) fail("Level 4 is filled but Sub-subcategory is empty. Fill the Sub-subcategory first.");
    if (deeper.some((part) => part.includes(",") || part.includes(">"))) fail("The category columns cannot contain a comma or a > sign. Use one column for each level.");

    const soon = parseYesNo(cell(row, "comingSoon"), false);
    // Several sizes may share one row ("14.5, 15, 15.5, 16"). Stock, price and old price then hold one value for all of them, or one value for each size in the same order.
    const sizeParts = splitList(cell(row, "size"));
    const count = Math.max(1, sizeParts.length);
    // Gives the texts for each size, or says in plain words what is wrong with the cell (and then nothing else is checked for that cell).
    const spreadOrFail = (key: string, label: string, plural: string, kind: "price" | "stock") => {
      const spread = spreadList(cell(row, key), count, kind);
      if ("cells" in spread) return spread.cells;
      if (spread.error === "ambiguous") fail(`“${String(cell(row, key)).trim()}” could be one number or a list of ${spread.found}. Write one number without a comma (1000), or put a space after every comma in a list (100, 200).`);
      else fail(`${count} sizes but ${spread.found} ${plural}. Type one ${label} for all of them, or one for each size in the same order (${sizeParts.join(", ")}).`);
      return null;
    };
    // A "coming soon" product may have no price or stock yet: it cannot be bought anyway.
    const priceCells = spreadOrFail("price", "price", "prices", "price");
    const prices = (priceCells ?? []).map((text) => {
      const value = soon && text === "" ? 0 : parseMoney(text);
      if (value === null || (!soon && value < 1)) fail(`Price “${text}” is not a number. Type it like 5500.`);
      return value as number;
    });
    const stockCells = spreadOrFail("stock", "stock number", "stock numbers", "stock");
    const stocks = (stockCells ?? []).map((text) => {
      const value = text === "" ? 0 : parseMoney(text);
      if (value === null || value < 0) fail(`Stock “${text}” is not a number. Type it like 12.`);
      return value as number;
    });
    const oldCells = spreadOrFail("oldPrice", "old price", "old prices", "price");
    const oldPrices = (oldCells ?? []).map((text, i) => {
      if (text === "") return null;
      const value = parseMoney(text);
      if (value === null) fail(`Old price “${text}” is not a number.`);
      else if (typeof prices[i] === "number" && value <= prices[i]) fail("The old price must be higher than the price (or leave it empty).");
      return value;
    });

    if (problems.length > before) continue;

    const sizes = (sizeParts.length ? sizeParts : [""]).map(normalizeSize);
    const given = String(cell(row, "code") ?? "").trim().toUpperCase().replace(/\s+/g, "");
    const key = `${name.toLowerCase()}|${colour.toLowerCase()}`;
    // Every size of the row is checked before anything is added: a repeated size (in this row, or already given on an earlier row of the same colour) skips the whole row.
    const taken = new Set((groups.get(key)?.variants ?? []).map((variant) => variant.size.toLowerCase()));
    const repeated = sizes.find((size) => (taken.has(size.toLowerCase()) ? true : (taken.add(size.toLowerCase()), false)));
    if (repeated !== undefined) {
      fail(`Size “${repeated || "(none)"}” of ${name} is listed twice.`);
      continue;
    }
    let product = groups.get(key);
    if (!product) {
      product = {
        key,
        row: excelRow,
        name,
        category,
        subcategory: String(cell(row, "subcategory") ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
        deeper: deeper.filter(Boolean),
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
    for (const file of splitList(cell(row, "photos"))) {
      if (!product.photos.some((p) => p.toLowerCase() === file.toLowerCase())) product.photos.push(file);
    }
    sizes.forEach((size, index) => {
      product.variants.push({ row: excelRow, size, sku: given || suggestSku(name, type, size), skuGiven: Boolean(given), price: prices[index], oldPrice: oldPrices[index], stock: stocks[index] });
    });
  }

  // The same product in more than one colour: the codes we make up must not collide (the same size in two colours), so the colour goes into them.
  // A code the owner wrote is never touched.
  const coloursOf = new Map<string, Set<string>>();
  for (const product of groups.values()) {
    const key = product.name.toLowerCase();
    coloursOf.set(key, (coloursOf.get(key) ?? new Set()).add(product.colour.toLowerCase()));
  }
  for (const product of groups.values()) {
    if ((coloursOf.get(product.name.toLowerCase())?.size ?? 0) < 2) continue;
    for (const variant of product.variants) if (!variant.skuGiven) variant.sku = suggestSku(product.name, product.type, variant.size, product.colour);
  }

  // One code written on every size of a product (FOR-132 on 8 rows) is the code of the product: each size gets its own, made from it (FOR-132-14.5).
  // The colours of one product page may share it too (FOR-132 on a white row and a beige row): then the colour goes in as well (FOR-132-BEIGE-14.5).
  // The same code on two DIFFERENT products is not touched here and is refused below.
  const codePart = (text: string) => text.toUpperCase().replace(/[()]/g, " ").trim().replace(/[^A-Z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
  const byName = new Map<string, ParsedProduct[]>();
  for (const product of groups.values()) byName.set(product.name.toLowerCase(), [...(byName.get(product.name.toLowerCase()) ?? []), product]);
  for (const sameName of byName.values()) {
    const uses = new Map<string, number>();
    const coloursUsing = new Map<string, Set<string>>();
    for (const product of sameName) {
      for (const variant of product.variants) {
        if (!variant.skuGiven) continue;
        const code = variant.sku.toLowerCase();
        uses.set(code, (uses.get(code) ?? 0) + 1);
        coloursUsing.set(code, (coloursUsing.get(code) ?? new Set()).add(product.colour.toLowerCase()));
      }
    }
    for (const product of sameName) {
      for (const variant of product.variants) {
        const code = variant.sku.toLowerCase();
        if (!variant.skuGiven || (uses.get(code) ?? 0) < 2) continue;
        const several = (coloursUsing.get(code)?.size ?? 0) > 1;
        variant.sku = [variant.sku, several ? codePart(product.colour) : "", codePart(variant.size) || "ONE"].filter(Boolean).join("-");
      }
    }
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

/** Where a product goes: the Category, then the Subcategory, Sub-subcategory and Level 4 inside it, written as one path ("Shirts > Formal Shirts"). */
export function categoryPathOf(product: Pick<ParsedProduct, "category" | "subcategory" | "deeper">): string {
  return [product.category, product.subcategory, ...product.deeper].filter(Boolean).join(" > ");
}
