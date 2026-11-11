import { expect, test } from "@playwright/test";
import { checkArguments, handleRpc, type ToolContext, type ToolDef } from "../../lib/mcp/protocol";
import { digestOf, groupColours, importPayload, previewOf, readRows, rowsToTable, splitByBudget, workOf, WORK_BUDGET } from "../../lib/import/sheet-rows";
import { SHEET_COLUMNS } from "../../lib/product-sheet";
import { parseScopes, SCOPES } from "../../lib/mcp/token";
import { CREATE_INPUT, PREPARE_INPUT, WAITING_INPUT } from "../../lib/mcp/product-tool-schemas";

const shirt = { name: "Plaid Check Shirt", category: "Shirts", subcategory: "Formal Shirts", type: "Shirt", colour: "Beige", size: "14.5, 15.5", price: "14500, 15500", stock: 2, code: "FOR-132", photos: "plaid-beige-1.jpg, plaid-beige-2.jpg", description: "A refined check." };
const shirtPink = { ...shirt, colour: "Pink", code: "FOR-133", photos: ["plaid-pink-1.jpg"], description: "" };

test.describe("AI products: the rows", () => {
  test("rows become the sheet's table: keys, titles and the importer's own spellings all work; lists and yes/no are written the sheet's way", () => {
    const { table, problems } = rowsToTable([{ name: "A", category: "Shirts", sizes: ["S", "M"], show: false, Price: 5000 }]);
    expect(table[0]).toEqual(SHEET_COLUMNS.map((column) => column.label));
    expect(problems).toEqual([]);
    const row = table[1];
    const at = (key: string) => row[SHEET_COLUMNS.findIndex((column) => column.key === key)];
    expect(at("category")).toBe("Shirts");
    expect(at("size")).toBe("S, M");
    expect(at("show")).toBe("No");
    expect(at("price")).toBe("5000");
  });

  test("a column the sheet does not know, or a row that is not an object, is a problem (a misspelt “prise” must never become an empty price)", () => {
    const { problems } = rowsToTable([{ name: "A", prise: 5000 }, "text", ["x"]]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/Row 1 has a column the sheet does not know: “prise”/);
    expect(problems[1]).toMatch(/Row 2 must be an object/);
  });

  test("the same reader as the upload checks them, and names the row the assistant sent", () => {
    const good = readRows([shirt, shirtPink]);
    expect(good.problems).toEqual([]);
    expect(good.parsed.products).toHaveLength(2);
    const bad = readRows([shirt, { ...shirt, name: "Bad Price Shirt", price: "cheap" }]);
    expect(bad.problems.some((message) => /^Row 2: Price “cheap” is not a number/.test(message))).toBe(true);
  });

  test("two colours of one name are ONE product page; the payload is always a draft and lists every picture the sheet promised", () => {
    const { parsed } = readRows([shirt, shirtPink]);
    const groups = groupColours(parsed.products);
    expect(groups).toHaveLength(1);
    const payload = importPayload(groups[0]);
    expect(payload.visibility).toBe("draft");
    expect(payload.category).toBe("Shirts > Formal Shirts");
    expect(payload.variants.map((variant) => [variant.color, variant.size, variant.price, variant.sku])).toEqual([
      ["Beige", "14.5", 14500, "FOR-132-14.5"],
      ["Beige", "15.5", 15500, "FOR-132-15.5"],
      ["Pink", "14.5", 14500, "FOR-133-14.5"],
      ["Pink", "15.5", 15500, "FOR-133-15.5"],
    ]);
    const pictures = payload.variants.flatMap((variant) => variant.images ?? []);
    expect(pictures.map((picture) => [picture.file, picture.isPrimary, picture.order])).toEqual([["plaid-beige-1.jpg", true, 0], ["plaid-beige-2.jpg", false, 1], ["plaid-pink-1.jpg", false, 0]]);
    expect(payload.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
  });

  test("the preview shows every size with its price, stock and code, and the totals", () => {
    const { parsed } = readRows([shirt, shirtPink]);
    const preview = previewOf(parsed.products);
    expect(preview.totals).toEqual({ products: 1, colours: 2, sizes: 4, pictures: 3 });
    expect(preview.products[0].colours[0].sizes).toEqual([
      { size: "14.5", price: 14500, oldPrice: null, stock: 2, code: "FOR-132-14.5" },
      { size: "15.5", price: 15500, oldPrice: null, stock: 2, code: "FOR-132-15.5" },
    ]);
  });

  test("the confirm code is the same for the same rows and changes with any price, stock, size, name, picture or colour", async () => {
    const code = async (rows: unknown[]) => digestOf(readRows(rows).parsed.products);
    const base = await code([shirt, shirtPink]);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(await code([shirt, shirtPink])).toBe(base);
    for (const change of [{ price: "14500, 15600" }, { stock: 3 }, { size: "14.5, 16.5" }, { name: "Plaid Shirt" }, { photos: "other.jpg" }, { colour: "Grey" }]) {
      expect(await code([{ ...shirt, ...change }, shirtPink])).not.toBe(base);
    }
  });

  test("the real schemas of prepare_products and create_products accept MAX_ROWS rows and refuse more, text instead of a list, no rows, and unknown options", () => {
    const rows = (n: number) => Array.from({ length: n }, () => ({}));
    for (const [name, schema, extra] of [["prepare_products", PREPARE_INPUT, {}], ["create_products", CREATE_INPUT, { confirm: "prep_x" }]] as const) {
      const check = (args: Record<string, unknown>) => checkArguments(schema as unknown as Record<string, unknown>, args);
      expect(check({ rows: rows(600), ...extra }), name).toBeNull();
      expect(check({ rows: rows(601), ...extra }), name).toMatch(/at most 600/);
      expect(check({ rows: "text", ...extra }), name).toMatch(/must be a list/);
      expect(check({ ...extra }), name).toMatch(/required/);
      expect(check({ rows: rows(1), ...extra, surprise: 1 }), name).toMatch(/Unknown option/);
    }
    expect(checkArguments(CREATE_INPUT as unknown as Record<string, unknown>, { rows: rows(1) })).toMatch(/“confirm” is required/);
    expect(checkArguments(WAITING_INPUT as unknown as Record<string, unknown>, { page: 2 })).toBeNull();
    expect(checkArguments(WAITING_INPUT as unknown as Record<string, unknown>, { page: 0 })).toMatch(/at least 1/);
  });

  test("a bad row keeps its place: the problems of the rows after it carry the numbers the assistant sent", () => {
    const { problems } = readRows([shirt, "not an object", { ...shirt, name: "Bad Price Shirt", code: "FOR-9", price: "cheap" }]);
    expect(problems.some((message) => /^Row 2 must be an object/.test(message))).toBe(true);
    expect(problems.some((message) => /^Row 3: Price “cheap” is not a number/.test(message))).toBe(true);
  });

  test("colours with one name must really be one product: a different category path or a different type is refused, the same is merged", () => {
    const other = { ...shirt, colour: "Pink", code: "FOR-133", photos: undefined };
    expect(readRows([shirt, other]).problems).toEqual([]);
    const elsewhere = readRows([shirt, { ...other, subcategory: "Casual Shirts" }]).problems;
    expect(elsewhere).toHaveLength(1);
    expect(elsewhere[0]).toMatch(/^Row 2: “Plaid Check Shirt” is in “Shirts > Casual Shirts” here but in “Shirts > Formal Shirts” on row 1/);
    expect(readRows([shirt, { ...other, type: "Kurta" }]).problems[0]).toMatch(/^Row 2: “Plaid Check Shirt” is a “Kurta” here but a “Shirt” on row 1/);
  });

  test("“will show on the website” is what the sheet says, also for a coming-soon product", () => {
    const visible = previewOf(readRows([{ ...shirt, comingSoon: "Yes" }]).parsed.products);
    expect(visible.products[0].willShowOnWebsite).toBe(true);
    const hidden = previewOf(readRows([{ ...shirt, show: "No" }]).parsed.products);
    expect(hidden.products[0].willShowOnWebsite).toBe(false);
  });
});

test.describe("AI products: the permission and the tools' labels", () => {
  test("“Add new products” is its own permission, said in plain words", () => {
    expect(Object.keys(SCOPES)).toContain("products:write");
    expect(SCOPES["products:write"]).toMatch(/hidden drafts/);
    expect(parseScopes("catalog:read,products:write")).toEqual(["catalog:read", "products:write"]);
  });

  test("a tool that changes the shop says so (readOnlyHint false) and is hidden from a token without its permission; a tool that only looks says true", async () => {
    const context = (scopes: ToolContext["scopes"]): ToolContext => ({ scopes, tokenId: "t", label: "test" });
    const base = { title: "T", description: "d", inputSchema: { type: "object", properties: {}, additionalProperties: false }, run: async () => ({}) };
    const tools: ToolDef[] = [
      { ...base, name: "look", scope: "catalog:read" },
      { ...base, name: "preview", scope: "products:write" },
      { ...base, name: "save", scope: "products:write", readOnly: false },
    ];
    const listed = async (scopes: ToolContext["scopes"]) => ((await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, tools, context(scopes))) as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }> } }).result.tools;
    expect((await listed(["catalog:read"])).map((tool) => tool.name)).toEqual(["look"]);
    const all = await listed(["catalog:read", "products:write"]);
    expect(all.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([["look", true], ["preview", true], ["save", false]]);
    expect(all.every((tool) => tool.annotations.destructiveHint === false)).toBe(true);
  });
});

test.describe("AI products: the work budget", () => {
  const many = (n: number) => groupColours(readRows(Array.from({ length: n }, (_, i) => ({ ...shirt, name: `Shirt ${i}`, code: `C-${i}`, photos: [`s${i}.jpg`] }))).parsed.products);

  test("a call that fits is done in one go; a big one is cut by work, in order, and at least one product always goes first", () => {
    const small = many(3);
    expect(splitByBudget(small).later).toEqual([]);
    const big = many(100);
    const { now, later } = splitByBudget(big);
    expect(now.length + later.length).toBe(100);
    expect(now.map((g) => g.key)).toEqual(big.slice(0, now.length).map((g) => g.key));
    expect(now.reduce((sum, g) => sum + workOf(g), 0)).toBeLessThanOrEqual(WORK_BUDGET);
    expect(splitByBudget(big, 1).now).toHaveLength(1);
  });
});

test.describe("Price on request", () => {
  test("an empty price, or “On request”, makes the product price-on-request; the preview and the payload say so; a half-priced row is refused", () => {
    const empty = readRows([{ ...shirt, name: "No Price Shirt", price: "" }, { ...shirt, name: "Words Shirt", code: "W-1", price: "On request" }, { ...shirt, name: "Priced Shirt", code: "P-1" }]);
    expect(empty.problems).toEqual([]);
    const [noPrice, words, priced] = empty.parsed.products;
    expect([noPrice.priceOnRequest, words.priceOnRequest, priced.priceOnRequest]).toEqual([true, true, false]);
    expect(noPrice.variants.map((v) => v.price)).toEqual([0, 0]);
    expect(noPrice.variants.every((v) => v.oldPrice === null)).toBe(true);
    expect(previewOf(empty.parsed.products).products.map((p) => p.priceOnRequest)).toEqual([true, true, false]);
    expect(importPayload(groupColours(empty.parsed.products)[0]).priceOnRequest).toBe(true);
    expect(importPayload(groupColours(empty.parsed.products)[2]).priceOnRequest).toBeUndefined();
    const half = readRows([{ ...shirt, name: "Half Shirt", price: "14500, " }]);
    expect(half.problems.some((m) => /Some sizes have a price and some do not/.test(m))).toBe(true);
    const mixed = readRows([{ ...shirt, name: "Two Colour Shirt" }, { ...shirt, name: "Two Colour Shirt", colour: "Pink", code: "X-2", price: "" }]);
    expect(mixed.problems.some((m) => /has a price here but none/.test(m))).toBe(true);
    expect(readRows([{ ...shirt, name: "Soon Shirt", price: "", coming_soon: "Yes" }]).parsed.products[0]?.priceOnRequest ?? false).toBe(false);
  });

  test("a different price-on-request flag gives a different confirmation code", async () => {
    const a = readRows([{ ...shirt, name: "Digest Shirt" }]).parsed.products;
    const b = readRows([{ ...shirt, name: "Digest Shirt", price: "" }]).parsed.products;
    expect(await digestOf(a)).not.toBe(await digestOf(b));
  });
});
