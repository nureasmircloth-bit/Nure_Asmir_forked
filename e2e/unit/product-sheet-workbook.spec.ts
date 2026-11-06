import { expect, test } from "@playwright/test";
import * as ExcelModule from "exceljs";
import { parseProductTable, SHEET_COLUMNS } from "../../lib/product-sheet";
import { buildProductWorkbook, EXAMPLES, EXAMPLE_ROWS, SIZE_SETS } from "../../lib/product-sheet-workbook";
import type { ExcelJSLike } from "../../lib/sheet-client";

const ExcelJS = ((ExcelModule as unknown as { default?: unknown }).default ?? ExcelModule) as unknown as ExcelJSLike & { Workbook: new () => { xlsx: { load: (data: ArrayBuffer) => Promise<void> }; getWorksheet: (name: string) => { getRow: (n: number) => { values: unknown[] }; rowCount: number } } };
const header = SHEET_COLUMNS.map((column) => column.label);

test.describe("the downloadable product sheet", () => {
  test("every example row is accepted by the real importer, and does what its note says", () => {
    const parsed = parseProductTable([header, ...EXAMPLE_ROWS]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rowCount).toBe(EXAMPLES.length);
    const product = (name: string, colour?: string) => parsed.products.find((p) => p.name === name && (!colour || p.colour === colour))!;

    expect(product("Olive Cargo Pants").variants.map((v) => [v.size, v.price, v.stock])).toEqual([["30", 6500, 10], ["32", 6500, 10], ["34", 6500, 10]]);
    expect(product("Classic Sky Blue Pinstripe Shirt").variants.map((v) => [v.size, v.stock])).toEqual([["14.5", 3], ["15.5", 5], ["16.5", 2], ["17.5", 1]]);
    expect(product("Classic Sky Blue Pinstripe Shirt").deeper).toEqual(["Business Formal Shirts"]);
    expect(product("Ivory Kameez Shalwar").variants.map((v) => [v.size, v.price, v.stock])).toEqual([["M", 12500, 6], ["L", 12500, 6], ["XL", 13500, 4]]);
    expect(product("Navy Waistcoat").variants.map((v) => [v.price, v.oldPrice])).toEqual([[8800, 10000], [8800, 10000], [8800, null]]);
    expect(product("Tan Leather Wallet").variants[0]).toMatchObject({ size: "One size", price: 3500, oldPrice: 4500 });
    expect(parsed.products.filter((p) => p.name === "Classic Cotton Shirt").map((p) => p.colour)).toEqual(["White", "Pink"]);
    expect(product("Classic Cotton Shirt", "Pink").variants.map((v) => v.sku)).toEqual(["FOR-111-14.5", "FOR-111-15.5", "FOR-111-16.5"]);
    expect(product("Plaid Check Shirt").variants.map((v) => v.sku)).toEqual(["FOR-132-14.5", "FOR-132-14.5-SLIM", "FOR-132-15.5", "FOR-132-15.5-SLIM"]);
    expect(product("Wing Collar Tuxedo Shirt").variants.map((v) => [v.size, v.sku, v.stock])).toEqual([["14.5", "FOR-134-14.5", 1], ["15.5", "FOR-134-15.5", 2]]);
    expect(product("Grey Linen Safari Suit").visible).toBe(false);
    expect(product("Charcoal Overcoat")).toMatchObject({ comingSoon: true, visible: true });
  });

  test("every example has a note, and the size dropdown lists are all readable", () => {
    for (const example of EXAMPLES) {
      expect(example.cells).toHaveLength(SHEET_COLUMNS.length);
      expect(example.note.length).toBeGreaterThan(30);
    }
    for (const set of SIZE_SETS) expect(set).toBe(set.trim());
  });

  test("the workbook has the four sheets; the example sheet's note column is ignored when its rows are read back from the file", async () => {
    const wb = buildProductWorkbook(ExcelJS, ["Shirts", "Pants"]) as unknown as { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } };
    const buffer = await wb.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    const sheet = (name: string) => (loaded as unknown as { getWorksheet: (n: string) => { getRow: (n: number) => { values: unknown[] }; rowCount: number } }).getWorksheet(name);
    expect(sheet("1 - How to fill")).toBeTruthy();
    expect(sheet("2 - Your products").rowCount).toBeGreaterThanOrEqual(1);
    expect(sheet("Lists")).toBeTruthy();

    const example = sheet("3 - Example");
    expect(example.rowCount).toBe(EXAMPLES.length + 1);
    const rows: unknown[][] = [];
    for (let r = 1; r <= example.rowCount; r++) rows.push((example.getRow(r).values as unknown[]).slice(1));
    expect(rows[0][SHEET_COLUMNS.length]).toBe("What this row shows");
    const parsed = parseProductTable(rows);
    expect(parsed.problems).toEqual([]);
    expect(parsed.products.reduce((sum, p) => sum + p.variants.length, 0)).toBe(3 + 4 + 3 + 3 + 1 + 3 + 3 + 4 + 2 + 3 + 1);
  });
});
