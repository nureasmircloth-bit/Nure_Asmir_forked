import { expect, test } from "@playwright/test";
import { checkArguments, handleRpc, type ToolContext, type ToolDef } from "../../lib/mcp/protocol";
import { digestOf, groupColours, importPayload, previewOf, readRows, rowsToTable, MAX_ROWS } from "../../lib/import/sheet-rows";
import { SHEET_COLUMNS } from "../../lib/product-sheet";
import { parseScopes, SCOPES } from "../../lib/mcp/token";

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

  test("the limits: the tool's schema accepts MAX_ROWS rows and refuses more, text instead of a list, or no rows", () => {
    const schema = { type: "object", properties: { rows: { type: "array", maxItems: MAX_ROWS } }, required: ["rows"], additionalProperties: false };
    expect(checkArguments(schema, { rows: Array.from({ length: MAX_ROWS }, () => ({})) })).toBeNull();
    expect(checkArguments(schema, { rows: Array.from({ length: MAX_ROWS + 1 }, () => ({})) })).toMatch(/at most 300/);
    expect(checkArguments(schema, { rows: "text" })).toMatch(/must be a list/);
    expect(checkArguments(schema, {})).toMatch(/required/);
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
