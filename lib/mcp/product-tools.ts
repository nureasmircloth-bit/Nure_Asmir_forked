// The tools that ADD products (permission “products:write”). Two steps, so nothing is saved by surprise: prepare_products only shows what would be made and hands out a one-use
// confirmation for exactly those rows; create_products saves the SAME rows, as hidden drafts, only with that confirmation (lib/mcp/guards.ts). The pictures are not part of it: the
// owner drops them in the admin, matched by the file names written in the rows, and publishes. Nothing that already exists can be changed or deleted from here.
//
// What the confirmation does and does not do: it makes the preview impossible to skip or reuse, and ties the save to the previewed rows. It cannot prove that a person read the preview.
// That is what the assistant is told to ask the owner, and in the end the owner's own Publish click is the approval: everything stays hidden until then.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { pendingPictures, products } from "@/db/schema";
import { createDrafts, shopProblems } from "@/lib/import/create-from-sheet";
import { digestOf, MAX_PRODUCTS, previewOf, readRows } from "@/lib/import/sheet-rows";
import { DAILY_LIMIT, issueConfirmation, redeemConfirmation, releaseQuota, reserveQuota } from "./guards";
import { CREATE_INPUT, PREPARE_INPUT, WAITING_INPUT } from "./product-tool-schemas";
import { ToolInputError, type ToolDef } from "./protocol";

/** Where the owner drops the pictures (the admin site's own address, from the site settings). */
const picturesPage = () => `${(process.env.NEXT_PUBLIC_ADMIN_URL || "https://admin.nureasmir.com").replace(/\/+$/, "")}/admin/products/new-pictures`;

/** How many products one page of products_waiting_for_pictures holds. */
const WAITING_PAGE = 20;

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
    "the categories that would be made and the pictures to add. NOTHING is saved. If it says ready, show the preview to the owner and ask whether to add them; only if they agree, call create_products with the same rows and the confirmation.",
  scope: "products:write",
  inputSchema: PREPARE_INPUT as unknown as Record<string, unknown>,
  async run(args, ctx) {
    const { parsed, preview, problems, newCategories } = await check(rowsOf(args));
    const ready = problems.length === 0 && parsed.products.length > 0;
    return {
      ready,
      problems,
      ...(ready ? { confirm: await issueConfirmation(ctx.tokenId, await digestOf(parsed.products)) } : {}),
      newCategoriesThatWillBeMade: newCategories,
      preview,
      next: ready
        ? "Show this preview to the owner and ask whether to add these products. If they agree, call create_products with exactly the same rows and the confirm value (it works once, for these rows, for 30 minutes). The products are saved as hidden drafts; the owner adds the pictures and publishes them in the admin."
        : "Fix the problems and call prepare_products again. Nothing was saved.",
    };
  },
};

/** Tool: save the previewed products as hidden drafts. */
const createProducts: ToolDef = {
  name: "create_products",
  title: "Add the previewed products",
  description:
    "Saves the products you just previewed with prepare_products, as HIDDEN DRAFTS, and remembers which pictures each one waits for. Needs the same rows and the one-use confirmation from the preview; " +
    "call it only after the owner has agreed to the preview. Products that already exist cannot be changed. The owner adds the pictures at the admin's “Pictures for new products” page and publishes them.",
  scope: "products:write",
  readOnly: false,
  inputSchema: CREATE_INPUT as unknown as Record<string, unknown>,
  async run(args, ctx) {
    const rows = rowsOf(args);
    const { parsed, preview, problems } = await check(rows);
    if (problems.length) throw new ToolInputError(`These rows cannot be added yet, nothing was saved: ${problems.slice(0, 12).join(" | ")}`);
    // The confirmation is used up here, in one atomic step: it must be this token's, made for exactly these rows, not used and not expired.
    if (!(await redeemConfirmation(ctx.tokenId, String(args.confirm ?? "").trim(), await digestOf(parsed.products)))) {
      throw new ToolInputError("The confirmation is wrong, was already used, has expired, or belongs to other rows. Call prepare_products again with these rows, show the owner the preview and use the new confirm value. Nothing was saved.");
    }
    const day = await reserveQuota(preview.totals.products);
    if (!day) throw new ToolInputError(`Assistants can add ${DAILY_LIMIT} products a day and today's room is used up (or too little is left for ${preview.totals.products}). Nothing was saved; try again tomorrow.`);

    let results;
    try {
      results = await createDrafts(parsed.products, ctx.label);
    } catch (error) {
      await releaseQuota(day, preview.totals.products).catch(() => undefined);
      throw error;
    }
    const made = results.filter((result) => result.ok);
    const deferred = results.filter((result) => result.deferred);
    await releaseQuota(day, preview.totals.products - made.length).catch(() => undefined); // room for the products that were not made goes back
    const pictures = made.reduce((sum, result) => sum + result.picturesWaiting, 0);
    return {
      added: made.length,
      failed: results.length - made.length - deferred.length,
      ...(deferred.length ? { notAddedYet: deferred.map((result) => result.name) } : {}),
      products: results,
      picturesWaiting: pictures,
      next:
        (deferred.length
          ? `${deferred.length} product${deferred.length === 1 ? " was" : "s were"} NOT added because this call was already big (${deferred.map((result) => result.name).slice(0, 8).join(", ")}${deferred.length > 8 ? ", …" : ""}). Nothing of them was saved: call prepare_products again with only those rows, show the owner the preview and use the new confirm value. `
          : "") +
        (made.length
          ? `Tell the owner: ${made.length} product${made.length === 1 ? " is" : "s are"} saved as hidden drafts. They are not on the website yet. Add the pictures (${pictures} file name${pictures === 1 ? " is" : "s are"} waiting) by dragging them onto ${picturesPage()}, then publish.`
          : "Nothing was added; see the messages."),
    };
  },
};

/** Tool: which new products still wait for pictures, and the file names expected. */
const waitingForPictures: ToolDef = {
  name: "products_waiting_for_pictures",
  title: "Products waiting for pictures",
  description: "The products assistants added that still wait for pictures, with the picture file names the owner has to drop at the admin's “Pictures for new products” page, 20 products a page. Use it to tell the owner exactly which files are missing; ask for the next page while the answer says hasMore.",
  scope: "catalog:read",
  inputSchema: WAITING_INPUT as unknown as Record<string, unknown>,
  async run(args) {
    const page = typeof args.page === "number" ? args.page : 1;
    // The products to show on this page (a stable order: name, then id), taken before their pictures are looked up, so a product is never split between two pages.
    const waiting = await db
      .selectDistinct({ id: products.id, name: products.name, status: products.status })
      .from(pendingPictures)
      .innerJoin(products, eq(products.id, pendingPictures.productId))
      .orderBy(products.name, products.id)
      .limit(WAITING_PAGE + 1)
      .offset((page - 1) * WAITING_PAGE);
    const shown = waiting.slice(0, WAITING_PAGE);
    const files = shown.length
      ? await db.select({ productId: pendingPictures.productId, file: pendingPictures.fileName, sortOrder: pendingPictures.sortOrder }).from(pendingPictures).where(inArray(pendingPictures.productId, shown.map((row) => row.id))).orderBy(pendingPictures.sortOrder, pendingPictures.fileName)
      : [];
    return {
      addPicturesHere: picturesPage(),
      page,
      hasMore: waiting.length > WAITING_PAGE,
      products: shown.map((row) => ({ product: row.name, status: row.status, filesWaiting: files.filter((file) => file.productId === row.id).map((file) => file.file) })),
    };
  },
};

/** The tools that add products, in the order they are used. */
export const productTools: ToolDef[] = [prepareProducts, createProducts, waitingForPictures];
