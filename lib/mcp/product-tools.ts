// The tools that ADD products (permission “products:write”). Two steps, so nothing is saved by surprise: prepare_products only shows what would be made and gives a confirm code;
// create_products saves the SAME rows, as hidden drafts, only when it gets that code. The pictures are not part of it: the owner drops them in the admin, matched by the file names
// written in the rows, and publishes. Nothing that already exists can be changed or deleted from here.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingPictures, products } from "@/db/schema";
import { addedToday, createDrafts, DAILY_LIMIT, shopProblems } from "@/lib/import/create-from-sheet";
import { digestOf, MAX_PRODUCTS, MAX_ROWS, previewOf, readRows } from "@/lib/import/sheet-rows";
import { SHEET_COLUMNS } from "@/lib/product-sheet";
import { ToolInputError, type ToolDef } from "./protocol";

/** Where the owner drops the pictures (the admin site's own address, from the site settings). */
const picturesPage = () => `${(process.env.NEXT_PUBLIC_ADMIN_URL || "https://admin.nureasmir.com").replace(/\/+$/, "")}/admin/products/new-pictures`;

const ROW_HELP =
  "One object for each COLOUR of a product (or for each size; both work and can be mixed), written like the owner's Excel sheet. Keys: " +
  SHEET_COLUMNS.map((column) => `${column.key}${column.required ? "*" : ""}`).join(", ") +
  ". Examples: sizes as one text with commas (\"14.5, 15.5, 16.5\") or a list; price, oldPrice and stock as ONE number for every size or one for each size in the same order (\"5800, 5800, 6200\"); " +
  "code is the owner's own article number (each size then gets its own code made from it); photos are the picture FILE NAMES the owner will drop later (\"white-1.jpg, white-2.jpg\"); " +
  "show is Yes/No. Another colour of the same product is another row with the same name and a different colour.";

const rowsSchema = { type: "array", items: { type: "object" }, maxItems: MAX_ROWS, description: ROW_HELP };

/** The rows from the arguments (a list of objects, at least one). */
function rowsOf(args: Record<string, unknown>): unknown[] {
  const rows = args.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new ToolInputError("“rows” must be a list with at least one row.");
  return rows;
}

/** Reads and checks the rows the way the upload does, then against the shop. */
async function check(rows: unknown[]) {
  const { parsed, problems } = readRows(rows);
  const shop = parsed.products.length ? await shopProblems(parsed.products) : { problems: [], newCategories: [] };
  const all = [...problems, ...shop.problems];
  const preview = previewOf(parsed.products);
  if (preview.totals.products > MAX_PRODUCTS) all.push(`That is ${preview.totals.products} products; at most ${MAX_PRODUCTS} can be added in one call. Send them in groups.`);
  return { parsed, preview, problems: all, newCategories: shop.newCategories };
}

/** Tool: show what would be created, without saving anything. */
const prepareProducts: ToolDef = {
  name: "prepare_products",
  title: "Preview new products",
  description:
    "Checks rows for NEW products exactly as the owner's Excel upload would, and shows what the shop would get: each product page with its colours, the price, stock and code of every size, " +
    "the categories that would be made and the pictures to add. NOTHING is saved. If it says ready, show the preview to the owner and, only if they agree, call create_products with the same rows and the confirm code.",
  scope: "products:write",
  inputSchema: { type: "object", properties: { rows: rowsSchema }, required: ["rows"], additionalProperties: false },
  async run(args) {
    const { parsed, preview, problems, newCategories } = await check(rowsOf(args));
    const ready = problems.length === 0 && parsed.products.length > 0;
    return {
      ready,
      problems,
      ...(ready ? { confirm: await digestOf(parsed.products) } : {}),
      newCategoriesThatWillBeMade: newCategories,
      preview,
      next: ready
        ? "Show this preview to the owner. If they say yes, call create_products with exactly the same rows and the confirm code. The products are saved as hidden drafts; the owner adds the pictures and publishes them in the admin."
        : "Fix the problems and call prepare_products again. Nothing was saved.",
    };
  },
};

/** Tool: save the previewed products as hidden drafts. */
const createProducts: ToolDef = {
  name: "create_products",
  title: "Add the previewed products",
  description:
    "Saves the products you just previewed with prepare_products, as HIDDEN DRAFTS, and remembers which pictures each one waits for. Needs the same rows and the confirm code from the preview, and the owner's yes. " +
    "Products that already exist cannot be changed. The owner adds the pictures at the admin's “Pictures for new products” page and publishes them.",
  scope: "products:write",
  readOnly: false,
  inputSchema: { type: "object", properties: { rows: rowsSchema, confirm: { type: "string", description: "The confirm code prepare_products gave for these exact rows." } }, required: ["rows", "confirm"], additionalProperties: false },
  async run(args, ctx) {
    const rows = rowsOf(args);
    const { parsed, preview, problems } = await check(rows);
    if (problems.length) throw new ToolInputError(`These rows cannot be added yet, nothing was saved: ${problems.slice(0, 12).join(" | ")}`);
    if ((await digestOf(parsed.products)) !== String(args.confirm ?? "").trim()) throw new ToolInputError("These rows are not the ones that were previewed (or the confirm code is wrong). Call prepare_products again, show the owner the preview and use its confirm code. Nothing was saved.");
    const today = await addedToday();
    if (today + preview.totals.products > DAILY_LIMIT) throw new ToolInputError(`Assistants can add ${DAILY_LIMIT} products a day; ${today} were added in the last 24 hours. Nothing was saved.`);

    const results = await createDrafts(parsed.products, ctx.label);
    const made = results.filter((result) => result.ok);
    return {
      added: made.length,
      failed: results.length - made.length,
      products: results,
      picturesWaiting: made.reduce((sum, result) => sum + result.picturesWaiting, 0),
      next: made.length
        ? `Tell the owner: ${made.length} product${made.length === 1 ? " is" : "s are"} saved as hidden drafts. They are not on the website yet. Add the pictures (${made.reduce((sum, result) => sum + result.picturesWaiting, 0)} file names are waiting) by dragging them onto ${picturesPage()}, then publish.`
        : "Nothing was added; see the messages.",
    };
  },
};

/** Tool: which new products still wait for pictures, and the file names expected. */
const waitingForPictures: ToolDef = {
  name: "products_waiting_for_pictures",
  title: "Products waiting for pictures",
  description: "The products assistants added that still wait for pictures, with the picture file names the owner has to drop at the admin's “Pictures for new products” page. Use it to tell the owner exactly which files are missing.",
  scope: "catalog:read",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run() {
    const rows = await db
      .select({ name: products.name, status: products.status, file: pendingPictures.fileName })
      .from(pendingPictures)
      .innerJoin(products, eq(products.id, pendingPictures.productId))
      .orderBy(products.name, pendingPictures.sortOrder)
      .limit(500);
    const byProduct = new Map<string, { product: string; status: string; filesWaiting: string[] }>();
    for (const row of rows) {
      const entry = byProduct.get(row.name) ?? { product: row.name, status: row.status, filesWaiting: [] };
      entry.filesWaiting.push(row.file);
      byProduct.set(row.name, entry);
    }
    return { addPicturesHere: picturesPage(), products: [...byProduct.values()] };
  },
};

/** The tools that add products, in the order they are used. */
export const productTools: ToolDef[] = [prepareProducts, createProducts, waitingForPictures];
