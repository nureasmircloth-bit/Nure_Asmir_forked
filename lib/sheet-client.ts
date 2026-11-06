"use client";

// Browser-only Excel helpers. The Excel library (ExcelJS, ~0.9 MB) is NOT part of the website's code bundle:
// it is a plain, versioned file in /public/vendor (cached by the browser permanently) that is fetched only after the
// owner opens the product screens (a quiet prefetch) or presses a button. That keeps the admin fast to open and the server code small.

import { parseCsv, SHEET_COLUMNS } from "./product-sheet";
import { ORDER_SHEET_COLUMNS } from "./order-sheet";
import { EXCELJS_URL } from "./vendor";

type ExcelJSLike = {
  Workbook: new () => {
    addWorksheet: (name: string, options?: Record<string, unknown>) => WorksheetLike;
    xlsx: { writeBuffer: () => Promise<ArrayBuffer>; load: (data: ArrayBuffer) => Promise<void> };
    worksheets: WorksheetLike[];
  };
};
type CellLike = { value: unknown; font?: Record<string, unknown>; fill?: Record<string, unknown>; alignment?: Record<string, unknown>; dataValidation?: Record<string, unknown>; border?: Record<string, unknown>; numFmt?: string; note?: unknown };
type RowLike = { height?: number; getCell: (index: number) => CellLike; values: unknown[]; eachCell: (cb: (cell: CellLike, col: number) => void) => void; font?: Record<string, unknown>; fill?: Record<string, unknown> };
export type WorksheetLike = {
  columns: Array<{ width?: number }>;
  getRow: (index: number) => RowLike;
  getCell: (ref: string) => CellLike;
  addRow: (values: unknown[]) => RowLike;
  mergeCells: (range: string) => void;
  views: unknown[];
  eachRow: (options: { includeEmpty: boolean }, cb: (row: RowLike, index: number) => void) => void;
  rowCount: number;
  state?: string;
  properties?: Record<string, unknown>;
};

let loading: Promise<ExcelJSLike> | null = null;

export function loadExcel(): Promise<ExcelJSLike> {
  const existing = (window as unknown as { ExcelJS?: ExcelJSLike }).ExcelJS;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<ExcelJSLike>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = EXCELJS_URL;
    script.async = true;
    script.onload = () => {
      const lib = (window as unknown as { ExcelJS?: ExcelJSLike }).ExcelJS;
      if (lib) resolve(lib);
      else reject(new Error("Excel tools did not start."));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load the Excel tools. Please check your internet and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function saveFile(data: ArrayBuffer | Blob | string, filename: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GREEN = "FF2B6B5E";

const EXAMPLE_ROWS: unknown[][] = [
  // The easy way: ONE row for each colour, the sizes typed with commas. One stock number and one price count for every size.
  ["Olive Cargo Pants", "Pants", "Cargo", "", "", "Cargo Pants", "Olive", "30, 32, 34", 6500, 7500, 10, "", "Cotton twill", "Relaxed cargo pants with deep pockets. Easy to wear every day.", "Yes", "olive-cargo-1.jpg, olive-cargo-2.jpg", "", "New"],
  // When the sizes differ, type one value for each size in the same order: M has 6 and costs 12500, L has 6 and costs 12500, XL has 4 and costs 13500.
  ["Ivory Kameez Shalwar", "Shalwar Kameez", "Wash & wear", "Summer", "", "Kameez Shalwar", "Ivory", "M, L, XL", "12500, 12500, 13500", "", "6, 6, 4", "", "Wash & wear", "A clean everyday kameez shalwar in soft wash & wear fabric.", "Yes", "ivory-ks-1.jpg", "", ""],
  // The other way also works: one row for each size (copy the name, category, type and colour down).
  ["Classic Sky Blue Pinstripe Shirt", "Shirts", "Formal Shirts", "Business Formal Shirts", "", "Shirt", "Sky blue", "M", 5800, "", 8, "", "Cotton blend", "A crisp pinstripe shirt with a white collar.", "Yes", "sky-blue-pinstripe-1.jpg", "", ""],
  ["Classic Sky Blue Pinstripe Shirt", "Shirts", "Formal Shirts", "Business Formal Shirts", "", "Shirt", "Sky blue", "L", 5800, "", 8, "", "", "", "Yes", "", "", ""],
  ["Tan Leather Wallet", "Accessories", "Wallets", "", "", "Wallet", "Tan", "One size", 3500, 4500, 20, "", "Leather", "Slim bifold wallet in genuine leather.", "Yes", "tan-wallet.jpg", "", "Sale"],
  // Coming soon: only a name, category and picture are needed; no price or stock yet, and the subcategory is left empty (it is optional).
  ["Charcoal Overcoat", "Coats", "", "", "", "Overcoat", "Charcoal", "", "", "", "", "", "", "", "Yes", "charcoal-overcoat.jpg", "Yes", ""],
];

/** Ready-made lists for the Size dropdown (a cell takes the whole text, e.g. "S, M, L, XL"). */
const SIZE_SETS = ["S, M, L, XL", "S, M, L, XL, XXL", "14.5, 15.5, 16.5, 17.5", "14.5, 15, 15.5, 16, 16.5, 17, 17.5", "28, 30, 32, 34, 36", "30, 32, 34, 36, 38, 40", "36, 38, 40, 42, 44", "One size"];

const TYPE_SUGGESTIONS = ["Shalwar Kameez", "Kameez Shalwar", "Kurta", "Shirt", "T-Shirt", "Polo Shirt", "Pants", "Cargo Pants", "Jeans", "Waistcoat", "Sweater", "Hoodie", "Wallet", "Belt", "Card Holder", "Cap", "Socks"];

function styleHeader(ws: WorksheetLike, columns = SHEET_COLUMNS.length) {
  const header = ws.getRow(1);
  header.height = 34;
  for (let c = 1; c <= columns; c++) {
    const cell = header.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle", wrapText: true };
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** The product sheet: instructions, an empty fill-in sheet with dropdowns, a worked example, and the lists. */
export async function downloadProductTemplate(categories: string[]) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();

  // 1. How to fill it
  const guide = wb.addWorksheet("1 - How to fill");
  guide.columns = [{ width: 4 }, { width: 100 }];
  const lines: Array<[string, boolean?]> = [
    ["How to add many products at once", true],
    ["1.  Open the sheet “2 - Your products”. If you are not sure about something, look at the sheet “3 - Example” first: it shows every case.", false],
    ["2.  Use ONE ROW FOR EACH COLOUR of a product. Type its name, category, type and colour.", false],
    ["3.  Sizes: click the Size cell and use the little arrow to pick a ready list (for example S, M, L, XL), or type your own sizes with commas:  14.5, 15, 15.5, 16.", false],
    ["4.  Stock and prices: ONE number counts for every size (Stock 3, Price 5800). When the sizes differ, type one number for each size in the same order, with a comma and a space after it:  Stock  3, 5, 2, 1   and   Price  5800, 5800, 6200, 6200.  The same works for the Old price. If the count does not fit the sizes, the upload tells you which row.", false],
    ["5.  Same product in another colour? Add another row with the SAME product name and the new colour. The website puts the colours on one page: the shopper swipes through the photos and the colour, price and sizes follow. Put each colour's photo names on that colour's row.", false],
    ["6.  Product code is YOUR article number, easy to remember. Leave it empty and we make one. Typing one code for the whole product (FOR-132) is fine too: each size then gets its own, like FOR-132-14.5 and FOR-132-15.5. Two different products must not share a code.", false],
    ["7.  Columns with a * are needed. The others you can leave empty. Fabric and Description are one text for the colour (write it on the first row of that colour; do not split it with commas).", false],
    ["8.  Category, Type and Yes/No have a little arrow: click the cell and pick from the list. Categories inside categories are optional: Category = Shirts, Subcategory = Formal Shirts, Sub-subcategory = Business Formal Shirts (then Level 4 if you need one). Fill them from left to right, copy them down on every row of the product, and a name that is new makes a new folder on the website. The product goes in the last one you fill.", false],
    ["9.  Photos: write the picture file names in “Photo file names” (for example olive-cargo-1.jpg). You choose the pictures on the website in the next step. The first name is the main photo.", false],
    ["10. Save this file and upload it on the website: Products → Add many with Excel. We check everything first and tell you the row of every mistake, so nothing goes wrong.", false],
    ["", false],
    ["Using Google Sheets? Open this file in Google Sheets (File → Import), fill it in, then File → Download → Microsoft Excel (.xlsx). Upload that file.", false],
    ["Prices are in rupees, numbers only (6500, not Rs. 6,500/-). Do not change the titles in the first row.", false],
  ];
  lines.forEach(([text, bold], index) => {
    const cell = guide.getCell(`B${index + 1}`);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
    cell.font = bold ? { bold: true, size: 16, color: { argb: GREEN } } : { size: 12 };
  });

  // 2. The sheet to fill
  const ws = wb.addWorksheet("2 - Your products");
  ws.columns = SHEET_COLUMNS.map((col) => ({ width: col.width }));
  SHEET_COLUMNS.forEach((col, index) => {
    const cell = ws.getRow(1).getCell(index + 1);
    cell.value = col.label;
    cell.note = col.help;
  });
  styleHeader(ws);

  // 3. Example
  const example = wb.addWorksheet("3 - Example");
  example.columns = SHEET_COLUMNS.map((col) => ({ width: col.width }));
  SHEET_COLUMNS.forEach((col, index) => {
    example.getRow(1).getCell(index + 1).value = col.label;
  });
  styleHeader(example);
  EXAMPLE_ROWS.forEach((row) => example.addRow(row));

  // 4. Lists for the dropdowns
  const lists = wb.addWorksheet("Lists");
  lists.getCell("A1").value = "Categories";
  lists.getCell("B1").value = "Types";
  lists.getCell("C1").value = "Yes/No";
  lists.getCell("D1").value = "Labels";
  lists.getCell("E1").value = "Size lists";
  SIZE_SETS.forEach((name, i) => (lists.getCell(`E${i + 2}`).value = name));
  const cats = categories.length ? categories : ["Shirts", "Pants", "Shalwar Kameez", "Accessories"];
  cats.forEach((name, i) => (lists.getCell(`A${i + 2}`).value = name));
  TYPE_SUGGESTIONS.forEach((name, i) => (lists.getCell(`B${i + 2}`).value = name));
  ["Yes", "No"].forEach((name, i) => (lists.getCell(`C${i + 2}`).value = name));
  ["", "New", "Sale", "Bestseller", "Limited"].forEach((name, i) => (name ? (lists.getCell(`D${i + 2}`).value = name) : undefined));

  const col = (key: string) => SHEET_COLUMNS.findIndex((c) => c.key === key) + 1;
  const letter = (n: number) => String.fromCharCode(64 + n);
  for (let r = 2; r <= 501; r++) {
    ws.getRow(r).getCell(col("category")).dataValidation = { type: "list", allowBlank: true, showErrorMessage: false, formulae: [`Lists!$A$2:$A$${cats.length + 30}`] };
    ws.getRow(r).getCell(col("type")).dataValidation = { type: "list", allowBlank: true, showErrorMessage: false, formulae: [`Lists!$B$2:$B$${TYPE_SUGGESTIONS.length + 1}`] };
    ws.getRow(r).getCell(col("show")).dataValidation = { type: "list", allowBlank: true, formulae: [`Lists!$C$2:$C$3`] };
    ws.getRow(r).getCell(col("comingSoon")).dataValidation = { type: "list", allowBlank: true, formulae: [`Lists!$C$2:$C$3`] };
    ws.getRow(r).getCell(col("label")).dataValidation = { type: "list", allowBlank: true, formulae: [`Lists!$D$2:$D$5`] };
    // Ready-made size lists to pick from; anything else can still be typed ("14.5, 16").
    ws.getRow(r).getCell(col("size")).dataValidation = { type: "list", allowBlank: true, showErrorMessage: false, formulae: [`Lists!$E$2:$E$${SIZE_SETS.length + 1}`] };
    // Price, old price and stock may hold one number or one for each size ("5800, 5800, 6200"), so Excel must not refuse a list; the upload checks every row and names the mistake.
    for (const key of ["price", "oldPrice", "stock"]) ws.getRow(r).getCell(col(key)).dataValidation = { type: "custom", allowBlank: true, showErrorMessage: false, formulae: ["TRUE"] };
  }
  void letter;

  saveFile(await wb.xlsx.writeBuffer(), "Nure-Asmir-products-sheet.xlsx", XLSX_TYPE);
}

export type StockExportRow = { product: string; size: string; sku: string; price: number; oldPrice: number | null; stock: number };

/** Current prices and stock as a sheet to edit and upload back. */
export async function downloadStockSheet(rows: StockExportRow[]) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Stock and prices");
  const headers = ["Product name (do not change)", "Size (do not change)", "Product code (do not change)", "Price (PKR)", "Old price (optional)", "In stock"];
  ws.columns = [{ width: 38 }, { width: 18 }, { width: 26 }, { width: 14 }, { width: 18 }, { width: 12 }];
  headers.forEach((text, i) => (ws.getRow(1).getCell(i + 1).value = text));
  styleHeader(ws, headers.length);
  rows.forEach((row) => ws.addRow([row.product, row.size, row.sku, row.price, row.oldPrice ?? "", row.stock]));
  for (let r = 2; r <= rows.length + 1; r++) for (let c = 1; c <= 3; c++) ws.getRow(r).getCell(c).font = { color: { argb: "FF777777" } };
  saveFile(await wb.xlsx.writeBuffer(), `Nure-Asmir-stock-${new Date().toISOString().slice(0, 10)}.xlsx`, XLSX_TYPE);
}

/** The order placement sheet: instructions, fill-in sheet with sample rows and dropdowns, and live store reference data. */
export async function downloadOrderTemplate(options: {
  zones: Array<{ id: string; name: string; deliveryCharge: number }>;
  variants: Array<{ sku: string; productName: string; variantName: string; price: number; available: number }>;
}) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();

  // 1. Instructions
  const guide = wb.addWorksheet("1 - How to fill");
  guide.columns = [{ width: 4 }, { width: 100 }];
  const lines: Array<[string, boolean?]> = [
    ["How to place orders in bulk with Excel", true],
    ["1.  Open the sheet called “2 - Orders”.", false],
    ["2.  Type ONE ROW FOR EACH ITEM. If an order has multiple items, use the same Order # (e.g. 1, 1) or repeat the customer details.", false],
    ["3.  Columns with a * are required: Customer Name, Phone, City, Province, Address, Delivery Zone, Payment Method, Product SKU, and Quantity.", false],
    ["4.  Delivery Zone: Pick from your store's active zones (see sheet “3 - Reference Data”).", false],
    ["5.  Payment Method: Type “cod” (Cash on Delivery) or “bank_deposit”.", false],
    ["6.  Payment Status: “pending” (default) or “paid” (if customer has already transferred to your bank account).", false],
    ["7.  Product SKU: Use the exact SKU codes listed in “3 - Reference Data”. Check available stock before placing.", false],
    ["8.  Delivery Charge: Leave empty to automatically calculate using your store's shipping rules, or enter PKR amount.", false],
    ["9.  Upload: Save this file and upload it in Admin → Orders → Bulk orders.", false],
    ["", false],
    ["Using Google Sheets? Open this file in Google Sheets (File → Import), fill it in, then File → Download → Microsoft Excel (.xlsx).", false],
  ];
  lines.forEach(([text, bold], index) => {
    const cell = guide.getCell(`B${index + 1}`);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
    cell.font = bold ? { bold: true, size: 16, color: { argb: GREEN } } : { size: 12 };
  });

  // 2. Orders Sheet
  const ws = wb.addWorksheet("2 - Orders");
  ws.columns = ORDER_SHEET_COLUMNS.map((col) => ({ width: col.width }));
  ORDER_SHEET_COLUMNS.forEach((col, index) => {
    const cell = ws.getRow(1).getCell(index + 1);
    cell.value = col.label;
    cell.note = col.help;
  });
  styleHeader(ws, ORDER_SHEET_COLUMNS.length);

  const primaryZone = options.zones[0]?.name ?? "Lahore";
  const sku1 = options.variants[0]?.sku ?? "SKU-001";
  const sku2 = options.variants[1]?.sku ?? "SKU-002";

  const SAMPLE_ORDERS: unknown[][] = [
    [1, "Ayesha Khan", "03001234567", "ayesha@example.com", "Lahore", "Punjab", "House 12, Street 4, DHA Phase 5", primaryZone, "cod", "pending", "", "", sku1, 1, "Call before delivery"],
    [2, "Bilal Ahmed", "03331234567", "", "Karachi", "Sindh", "Flat 7, Block B, Clifton", primaryZone, "bank_deposit", "paid", 0, 100, sku1, 1, "Fragile packing"],
    [2, "Bilal Ahmed", "03331234567", "", "Karachi", "Sindh", "Flat 7, Block B, Clifton", primaryZone, "bank_deposit", "paid", 0, 100, sku2, 2, ""],
  ];
  SAMPLE_ORDERS.forEach((row) => ws.addRow(row));

  // 3. Reference Data
  const ref = wb.addWorksheet("3 - Reference Data");
  ref.columns = [{ width: 24 }, { width: 18 }, { width: 30 }, { width: 16 }, { width: 18 }, { width: 12 }, { width: 12 }];
  ref.getRow(1).values = ["Allowed Zones", "Provinces", "Sellable Product", "Variant / Size", "Product SKU", "Price (PKR)", "In Stock"];
  styleHeader(ref, 7);

  const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad Capital Territory", "Gilgit-Baltistan", "Azad Jammu and Kashmir"];
  const maxRows = Math.max(options.zones.length, PROVINCES.length, options.variants.length);
  for (let i = 0; i < maxRows; i++) {
    const z = options.zones[i];
    const p = PROVINCES[i];
    const v = options.variants[i];
    ref.addRow([
      z ? z.name : "",
      p ?? "",
      v ? v.productName : "",
      v ? v.variantName : "",
      v ? v.sku : "",
      v ? v.price : "",
      v ? v.available : "",
    ]);
  }

  saveFile(await wb.xlsx.writeBuffer(), "Nure-Asmir-orders-bulk-template.xlsx", XLSX_TYPE);
}

function cellText(value: unknown): unknown {
  if (value && typeof value === "object") {
    const v = value as { text?: string; richText?: Array<{ text: string }>; result?: unknown; hyperlink?: string };
    if (v.richText) return v.richText.map((part) => part.text).join("");
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
    if (value instanceof Date) return value.toISOString();
  }
  return value;
}

/** Reads the first sheet that looks like a product/stock/orders sheet, from an .xlsx or .csv file. */
export async function readSheetFile(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Please choose an Excel file (.xlsx) or a .csv file. Old .xls files: open them in Excel and use Save As → Excel Workbook.");
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer()); // the sheets must be read before one is chosen
  const isInstruction = (name: string) => /instructions|how to fill|lists|reference|guide|readme/i.test(name);
  const eligible = wb.worksheets.filter((sheet) => !isInstruction(String((sheet as unknown as { name?: string }).name ?? "")));
  const pool = eligible.length > 0 ? eligible : wb.worksheets;
  const wanted = pool.find((sheet) => /your products|products|stock|orders|order/i.test(String((sheet as unknown as { name?: string }).name ?? ""))) ?? pool[0] ?? wb.worksheets[0];
  const table: unknown[][] = [];
  wanted.eachRow({ includeEmpty: false }, (row, index) => {
    const values = (row.values as unknown[]).slice(1).map(cellText);
    table[index - 1] = values;
  });
  for (let i = 0; i < table.length; i++) table[i] ??= [];
  return table;
}

