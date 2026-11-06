import { expect, test } from "@playwright/test";
import { cancelBlockReason, canCancel, courierStage, customerFacingCourierStatus, refundEligibility } from "../../lib/order-rules";
import { splitAddress, splitName, tcsDate, toPkMobile } from "../../lib/tcs";
import { parseCsv, parseMoney, parseProductTable, parseUpdateTable, parseYesNo, SHEET_COLUMNS } from "../../lib/product-sheet";
import { suggestSku } from "../../lib/sku";
import { buildLocalIndex, searchLocal } from "../../lib/search/local";
import { isQuotaError } from "../../lib/search/quota";
import type { SearchDoc } from "../../lib/search/types";

test.describe("cancel rule: only until TCS has the parcel", () => {
  test("every pre-handover status can be cancelled, everything after cannot", () => {
    for (const status of ["pending_confirmation", "confirmed", "processing", "packed"]) expect(canCancel({ orderStatus: status }), status).toBe(true);
    for (const status of ["shipped", "delivered", "cancelled", "returned"]) expect(canCancel({ orderStatus: status }), status).toBe(false);
  });
  test("a recorded TCS handover blocks cancelling even if the status text is stale", () => {
    expect(canCancel({ orderStatus: "packed", handedOverAt: new Date() })).toBe(false);
    expect(cancelBlockReason({ orderStatus: "shipped" }, "customer")).toMatch(/handed to TCS/i);
    expect(cancelBlockReason({ orderStatus: "delivered" }, "customer")).toMatch(/refund/i);
  });
});

test.describe("TCS status text → stage", () => {
  const cases: Array<[string, ReturnType<typeof courierStage>]> = [
    ["Shipment Booked", "booked"],
    ["Booked", "booked"],
    ["Shipment Picked Up", "handed_over"],
    ["Arrived at TCS Facility", "handed_over"],
    ["Departed from Karachi", "handed_over"],
    ["Out For Delivery", "out_for_delivery"],
    ["Shipment Delivered", "delivered"],
    ["Delivered", "delivered"],
    ["Delivery Attempted - Consignee not available", "failed_attempt"],
    ["Return to Shipper", "returned"],
    ["Shipment Returned to Origin", "returned"],
    ["Something unknown", null],
    ["", null],
  ];
  for (const [text, stage] of cases) test(`"${text}" → ${stage}`, () => expect(courierStage(text)).toBe(stage));
  test("customers get friendly words", () => {
    expect(customerFacingCourierStatus("Out For Delivery")).toMatch(/today/i);
    expect(customerFacingCourierStatus("Arrived at TCS Facility")).toBe("On its way");
  });
});

test.describe("refund window", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  test("allowed inside the window, refused after it, once only", () => {
    expect(refundEligibility({ orderStatus: "delivered", deliveredAt: new Date("2026-10-17T10:00:00Z") }, 7, false, now).ok).toBe(true);
    expect(refundEligibility({ orderStatus: "delivered", deliveredAt: new Date("2026-10-01T10:00:00Z") }, 7, false, now).ok).toBe(false);
    expect(refundEligibility({ orderStatus: "delivered", deliveredAt: new Date("2026-10-19T10:00:00Z") }, 7, true, now).ok).toBe(false);
    expect(refundEligibility({ orderStatus: "shipped", deliveredAt: null }, 7, false, now).ok).toBe(false);
  });
});

test.describe("TCS payload helpers", () => {
  test("phone numbers are normalised to 03xxxxxxxxx", () => {
    expect(toPkMobile("+92 300 1234567")).toBe("03001234567");
    expect(toPkMobile("923001234567")).toBe("03001234567");
    expect(toPkMobile("0300-1234567")).toBe("03001234567");
    expect(toPkMobile("042-35761234")).toBeNull();
    expect(toPkMobile("")).toBeNull();
  });
  test("names meet TCS's 3-character minimum", () => {
    expect(splitName("Ali")).toEqual({ first: "Ali", middle: "Customer", last: "" });
    expect(splitName("Al Ra")).toEqual({ first: "Al.", middle: "Ra.", last: "" });
    expect(splitName("Muhammad Usman Khan Niazi")).toMatchObject({ first: "Muhammad", middle: "Usman" });
  });
  test("long addresses are split on spaces into three 120-character lines", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Street${i}`).join(" ");
    const [a, b, c] = splitAddress(long);
    for (const line of [a, b, c]) expect(line.length).toBeLessThanOrEqual(120);
    expect(`${a} ${b} ${c}`.trim().split(" ").length).toBeGreaterThan(30);
    expect(splitAddress("House 4")[1]).toBe("");
  });
  test("dates use TCS's DD/MM/YYYY HH:mm:ss in Pakistan time", () => {
    expect(tcsDate(new Date("2026-10-05T19:30:05Z"))).toBe("06/10/2026 00:30:05");
  });
});

test.describe("product sheet (Excel / Google Sheets)", () => {
  const header = SHEET_COLUMNS.map((c) => c.label);
  const row = (v: Record<string, unknown>) => SHEET_COLUMNS.map((c) => v[c.key] ?? "");

  test("one row per size becomes one product with several sizes", () => {
    const table = [
      header,
      row({ name: "Olive Cargo Pants", category: "Pants", type: "Cargo Pants", colour: "Olive", size: "30", price: "6,500", stock: 10, photos: "olive-1.jpg, olive-2.jpg" }),
      row({ name: "Olive Cargo Pants", category: "Pants", type: "Cargo Pants", colour: "Olive", size: "32", price: 6500, oldPrice: 7500, stock: "14" }),
      row({ name: "Tan Wallet", category: "Accessories", type: "Wallet", colour: "Tan", size: "one size", price: "Rs. 3500/-", stock: 20, show: "No", label: "sale" }),
      row({}),
    ];
    const parsed = parseProductTable(table);
    expect(parsed.problems).toEqual([]);
    expect(parsed.products).toHaveLength(2);
    const pants = parsed.products[0];
    expect(pants.variants.map((v) => [v.size, v.price, v.stock])).toEqual([["30", 6500, 10], ["32", 6500, 14]]);
    expect(pants.variants[1].oldPrice).toBe(7500);
    expect(pants.photos).toEqual(["olive-1.jpg", "olive-2.jpg"]);
    expect(pants.variants[0].sku).toBe(suggestSku("Olive Cargo Pants", "Cargo Pants", "30"));
    const wallet = parsed.products[1];
    expect(wallet.variants[0]).toMatchObject({ size: "One size", price: 3500 });
    expect(wallet.visible).toBe(false);
    expect(wallet.label).toBe("Sale");
  });

  test("price and old price can also be one value for each size; a thousands comma is not a list", () => {
    const base = { category: "Shirts", type: "Shirt", colour: "White", stock: 3 };
    const table = [
      header,
      row({ ...base, name: "Mixed Price Shirt", size: "M, L, XL", price: "12500, 12500, 13500", oldPrice: "14000, , 15000" }),
      row({ ...base, name: "Thousands Shirt", size: "M, L", price: "6,500", oldPrice: "Rs. 7,500/-" }),
      row({ ...base, name: "Wrong Count Shirt", size: "M, L, XL", price: "5000, 5200" }),
      row({ ...base, name: "Bad Old Shirt", size: "M, L", price: "5000, 6000", oldPrice: "5500, 5500" }),
    ];
    const parsed = parseProductTable(table);
    const mixed = parsed.products.find((p) => p.name === "Mixed Price Shirt")!;
    expect(mixed.variants.map((v) => [v.size, v.price, v.oldPrice])).toEqual([["M", 12500, 14000], ["L", 12500, null], ["XL", 13500, 15000]]);
    const thousands = parsed.products.find((p) => p.name === "Thousands Shirt")!;
    expect(thousands.variants.map((v) => [v.price, v.oldPrice])).toEqual([[6500, 7500], [6500, 7500]]);
    const messages = parsed.problems.map((p) => `${p.row}: ${p.message}`);
    expect(messages.some((m) => m.startsWith("4:") && /3 sizes but 2 prices/.test(m))).toBe(true);
    expect(messages.some((m) => m.startsWith("5:") && /old price must be higher/i.test(m))).toBe(true);
    expect(parsed.products.map((p) => p.name)).not.toContain("Wrong Count Shirt");
  });

  test("several sizes in one cell become several sizes of one colour, with one stock number or one for each size", () => {
    const base = { category: "Shirts", type: "Shirt", price: 6800 };
    const table = [
      header,
      row({ ...base, name: "Classic Cotton Shirt", colour: "White", size: "14.5, 15, 15.5, 16", stock: 3 }),
      row({ ...base, name: "Plain Shirt", colour: "Blue", size: "14.5; 15 ,15.5", stock: "4, 2, 0" }),
      row({ ...base, name: "Big Stock Shirt", colour: "Grey", size: "M", stock: "1,000" }),
    ];
    const parsed = parseProductTable(table);
    expect(parsed.problems).toEqual([]);
    expect(parsed.products[0].variants.map((v) => [v.size, v.stock])).toEqual([["14.5", 3], ["15", 3], ["15.5", 3], ["16", 3]]);
    expect(new Set(parsed.products[0].variants.map((v) => v.sku)).size).toBe(4);
    expect(parsed.products[1].variants.map((v) => [v.size, v.stock])).toEqual([["14.5", 4], ["15", 2], ["15.5", 0]]);
    expect(parsed.products[2].variants[0].stock).toBe(1000);
  });

  test("a size cell with a list is checked: wrong number of stock numbers, a size repeated across rows", () => {
    const base = { category: "Shirts", type: "Shirt", price: 6800 };
    const table = [
      header,
      row({ ...base, name: "A", colour: "White", size: "S, M, L", stock: "1, 2" }),
      row({ ...base, name: "C", colour: "White", size: "S, M", stock: 2 }),
      row({ ...base, name: "C", colour: "White", size: "M", stock: 2 }),
    ];
    const messages = parseProductTable(table).problems.map((p) => `${p.row}: ${p.message}`);
    expect(messages.some((m) => m.startsWith("2:") && /3 sizes but 2 stock numbers/.test(m))).toBe(true);
    expect(messages.some((m) => m.startsWith("4:") && /listed twice/i.test(m))).toBe(true);
  });

  test("one product code typed on every size of a product (FOR-132 on 8 rows) gives each size its own code; other products must still use other codes", () => {
    const base = { category: "Shirts", type: "Shirt", colour: "Beige", price: 14500, stock: 1 };
    const table = [
      header,
      row({ ...base, name: "Plaid Check Shirt", size: "14.5", code: "for-132" }),
      row({ ...base, name: "Plaid Check Shirt", size: "14.5 (SLIM)", code: "FOR-132" }),
      row({ ...base, name: "Plaid Check Shirt", size: "15.5", code: "FOR-132" }),
      row({ ...base, name: "Cotton Shirt", size: "S, M", code: "FOR-117" }),
      row({ ...base, name: "Other Shirt", size: "S", code: "FOR-132-15.5" }),
    ];
    const parsed = parseProductTable(table);
    expect(parsed.products[0].variants.map((v) => v.sku)).toEqual(["FOR-132-14.5", "FOR-132-14.5-SLIM", "FOR-132-15.5"]);
    expect(parsed.products[1].variants.map((v) => v.sku)).toEqual(["FOR-117-S", "FOR-117-M"]);
    expect(parsed.problems.map((p) => p.message).join("|")).toMatch(/FOR-132-15\.5 is already used on row 4/);
    expect(parsed.products.map((p) => p.name)).toContain("Plaid Check Shirt");
  });

  test("mistakes are reported with the Excel row number, in plain words, and bad rows are skipped", () => {
    const table = [
      header,
      row({ name: "Good Shirt", category: "Shirts", type: "Shirt", colour: "White", size: "M", price: 4000, stock: 3 }),
      row({ name: "Bad Price", category: "Shirts", type: "Shirt", colour: "White", size: "M", price: "cheap", stock: 3 }),
      row({ name: "", category: "Shirts", type: "Shirt", colour: "White", size: "M", price: 100, stock: 3 }),
      row({ name: "Good Shirt", category: "Shirts", type: "Shirt", colour: "White", size: "M", price: 4000, stock: 3 }),
      row({ name: "Discount Wrong", category: "Shirts", type: "Shirt", colour: "Blue", size: "L", price: 4000, oldPrice: 3000, stock: 1 }),
      row({ name: "Same Code A", category: "Shirts", type: "Shirt", colour: "Red", size: "S", price: 100, stock: 1, code: "x-1" }),
      row({ name: "Same Code B", category: "Shirts", type: "Shirt", colour: "Red", size: "S", price: 100, stock: 1, code: "X-1" }),
    ];
    const parsed = parseProductTable(table);
    const messages = parsed.problems.map((p) => `${p.row}: ${p.message}`);
    expect(messages.some((m) => m.startsWith("3:") && /Price .*cheap.* is not a number/.test(m))).toBe(true);
    expect(messages.some((m) => m.startsWith("4:") && /name is empty/i.test(m))).toBe(true);
    expect(messages.some((m) => m.startsWith("5:") && /listed twice/i.test(m))).toBe(true);
    expect(messages.some((m) => m.startsWith("6:") && /old price must be higher/i.test(m))).toBe(true);
    expect(messages.some((m) => m.startsWith("8:") && /already used on row 7/i.test(m))).toBe(true);
    expect(parsed.products.map((p) => p.name)).toContain("Good Shirt");
    expect(parsed.products.map((p) => p.name)).not.toContain("Bad Price");
  });

  test("the same product in two colours: the made-up codes differ (the colour is in them), written codes are kept, and the colours stay one product name", () => {
    const table = [
      header,
      row({ name: "Royal Shirt", category: "Shirts", type: "Shirt", colour: "Navy", size: "M", price: 5000, stock: 3 }),
      row({ name: "Royal Shirt", category: "Shirts", type: "Shirt", colour: "Navy", size: "L", price: 5000, stock: 3 }),
      row({ name: "Royal Shirt", category: "Shirts", type: "Shirt", colour: "Maroon", size: "M", price: 5200, stock: 2 }),
      row({ name: "Royal Shirt", category: "Shirts", type: "Shirt", colour: "Maroon", size: "L", price: 5200, stock: 2, code: "RS-MAR-L" }),
    ];
    const parsed = parseProductTable(table);
    expect(parsed.problems).toEqual([]);
    expect(parsed.products.map((p) => p.colour)).toEqual(["Navy", "Maroon"]);
    const codes = parsed.products.flatMap((p) => p.variants.map((v) => v.sku));
    expect(new Set(codes).size).toBe(4);
    expect(codes).toContain("RS-MAR-L");
    expect(codes[0]).toBe(suggestSku("Royal Shirt", "Shirt", "M", "Navy"));
    // a product in one colour keeps the plain code
    const single = parseProductTable([header, row({ name: "Olive Cargo Pants", category: "Pants", type: "Cargo Pants", colour: "Olive", size: "30", price: 100, stock: 1 })]);
    expect(single.products[0].variants[0].sku).toBe(suggestSku("Olive Cargo Pants", "Cargo Pants", "30"));
  });

  test("a sheet without titles explains what to do, titles may be in any order and any wording we know", () => {
    expect(parseProductTable([["a", "b"], [1, 2]]).problems[0].message).toMatch(/column titles/i);
    const shuffled = parseProductTable([
      ["Price", "Item", "Category", "What is it?", "Color", "Qty"],
      [2500, "Leather Belt", "Accessories", "Belt", "Brown", 7],
    ]);
    expect(shuffled.problems).toEqual([]);
    expect(shuffled.products[0]).toMatchObject({ name: "Leather Belt", colour: "Brown" });
  });

  test("csv from Google Sheets (quotes, commas, BOM) is read", () => {
    const csv = '﻿Product name*,Category*,"What is it?*",Colour*,Size,Price (PKR)*,Stock*\r\n"Kameez, Ivory",Shalwar Kameez,Kameez Shalwar,Ivory,M,"12,500",6\r\n';
    const parsed = parseProductTable(parseCsv(csv));
    expect(parsed.problems).toEqual([]);
    expect(parsed.products[0].name).toBe("Kameez, Ivory");
    expect(parsed.products[0].variants[0].price).toBe(12500);
  });

  test("money and yes/no readers", () => {
    expect(parseMoney("PKR 1,250")).toBe(1250);
    expect(parseMoney("12.6")).toBe(13);
    expect(parseMoney("abc")).toBeNull();
    expect(parseYesNo("Haan", false)).toBe(true);
    expect(parseYesNo("nahi", true)).toBe(false);
    expect(parseYesNo("", true)).toBe(true);
  });

  test("stock update sheet is matched by product code", () => {
    const result = parseUpdateTable([
      ["Product name (do not change)", "Size (do not change)", "Product code (do not change)", "Price (PKR)", "Old price (optional)", "In stock"],
      ["Olive Cargo Pants", "30", "NA-PA-CAR-30", 6800, "", 12],
      ["Olive Cargo Pants", "32", "NA-PA-CAR-32", "abc", "", 3],
      ["Olive Cargo Pants", "34", "NA-PA-CAR-30", 100, "", 3],
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ sku: "NA-PA-CAR-30", price: 6800, stock: 12, oldPrice: null });
    expect(result.problems.map((p) => p.row)).toEqual([3, 4]);
  });
});

test.describe("built-in fallback search (MiniSearch)", () => {
  const doc = (id: string, name: string, type: string, extra: Partial<SearchDoc> = {}): SearchDoc => ({
    objectID: id, name, slug: id, category: "Cat", categorySlug: "cat", type, color: "Black", sizes: ["M"], price: 1000, inStock: true, badge: "", description: "", imageUrl: null, blurDataUrl: null, featured: false, publishedAt: 0, ...extra,
  });
  const index = buildLocalIndex([doc("1", "Espresso Kameez Shalwar", "Kameez Shalwar"), doc("2", "Olive Cargo Pants", "Cargo Pants"), doc("3", "Tan Leather Wallet", "Wallet"), doc("4", "Ivory Sashiko Tee", "T-Shirt")]);

  test("typos, prefixes and Pakistani spellings still find the product", () => {
    expect(searchLocal(index, "kamez", 5).hits[0]?.objectID).toBe("1");
    expect(searchLocal(index, "qameez", 5).hits.map((h) => h.objectID)).toContain("1");
    expect(searchLocal(index, "trousers", 5).hits[0]?.objectID).toBe("2");
    expect(searchLocal(index, "purse", 5).hits[0]?.objectID).toBe("3");
    expect(searchLocal(index, "tshirt", 5).hits[0]?.objectID).toBe("4");
    expect(searchLocal(index, "oliv", 5).hits[0]?.objectID).toBe("2");
  });
  test("highlights matches safely and returns nothing for gibberish", () => {
    expect(searchLocal(index, "wallet", 5).hits[0].highlight).toContain("<mark>Wallet</mark>");
    expect(searchLocal(index, "zzzzqqqq", 5).hits).toEqual([]);
  });
  test("quota-type Algolia failures are recognised", () => {
    expect(isQuotaError({ status: 429 })).toBe(true);
    expect(isQuotaError({ status: 403, message: "Index not allowed" })).toBe(true);
    expect(isQuotaError(new Error("Monthly quota exceeded"))).toBe(true);
    expect(isQuotaError(new Error("network down"))).toBe(false);
  });
});
