// The Excel file the owner downloads to add many products at once: instructions, a sheet to fill, a worked example for every case, and the lists behind the dropdowns.
// No browser code here (the Excel library is passed in), so the same workbook is also made by scripts/make-product-sheet.ts and the examples are checked by a unit test:
// every example row must be accepted by the real importer.

import { SHEET_COLUMNS } from "./product-sheet";
import type { ExcelJSLike, WorksheetLike } from "./sheet-client";

export const GREEN = "FF2B6B5E";
const GREY = "FF4A4A48";

export function styleHeader(ws: WorksheetLike, columns = SHEET_COLUMNS.length) {
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

/** Ready-made lists for the Size dropdown (a cell takes the whole text, e.g. "S, M, L, XL"). */
export const SIZE_SETS = ["S, M, L, XL", "S, M, L, XL, XXL", "14.5, 15.5, 16.5, 17.5", "14.5, 15, 15.5, 16, 16.5, 17, 17.5", "28, 30, 32, 34, 36", "30, 32, 34, 36, 38, 40", "36, 38, 40, 42, 44", "One size"];

export const TYPE_SUGGESTIONS = ["Shalwar Kameez", "Kameez Shalwar", "Kurta", "Shirt", "T-Shirt", "Polo Shirt", "Pants", "Cargo Pants", "Jeans", "Waistcoat", "Safari Suit", "Sweater", "Hoodie", "Wallet", "Belt", "Card Holder", "Cap", "Socks"];

/**
 * Every case in a row of its own, with a sentence that says what the row shows. The cells follow SHEET_COLUMNS:
 * name, category, subcategory, sub-subcategory, level 4, type, colour, size, price, old price, stock, product code, fabric, description, show, photos, coming soon, label.
 */
export const EXAMPLES: Array<{ cells: unknown[]; note: string }> = [
  {
    cells: ["Olive Cargo Pants", "Pants", "Cargo", "", "", "Cargo Pants", "Olive", "30, 32, 34", 6500, "", 10, "", "Cotton twill", "Relaxed cargo pants with deep pockets. Easy to wear every day.", "Yes", "olive-cargo-1.jpg, olive-cargo-2.jpg", "", "New"],
    note: "THE EASY WAY. One row for the colour; the sizes are typed with commas. One price and one stock number count for every size (10 pieces of each). The label “New” shows on the picture. The first photo name is the main photo.",
  },
  {
    cells: ["Classic Sky Blue Pinstripe Shirt", "Shirts", "Formal Shirts", "Business Formal Shirts", "", "Shirt", "Sky blue", "14.5, 15.5, 16.5, 17.5", 5800, "", "3, 5, 2, 1", "", "Cotton blend", "A crisp pinstripe shirt with a white collar.", "Yes", "sky-blue-pinstripe-1.jpg", "", ""],
    note: "DIFFERENT STOCK FOR EACH SIZE. The stock numbers follow the sizes in the same order: 14.5 has 3, 15.5 has 5, 16.5 has 2, 17.5 has 1. Also shows a category inside a category: Shirts > Formal Shirts > Business Formal Shirts.",
  },
  {
    cells: ["Ivory Kameez Shalwar", "Shalwar Kameez", "Wash & wear", "Summer", "", "Kameez Shalwar", "Ivory", "M, L, XL", "12500, 12500, 13500", "", "6, 6, 4", "", "Wash & wear", "A clean everyday kameez shalwar in soft wash & wear fabric.", "Yes", "ivory-ks-1.jpg", "", ""],
    note: "DIFFERENT PRICE AND STOCK FOR EACH SIZE. M costs 12500 and has 6, L costs 12500 and has 6, XL costs 13500 and has 4. Type a comma and a space between the numbers.",
  },
  {
    cells: ["Navy Waistcoat", "Waistcoats", "", "", "", "Waistcoat", "Navy", "S, M, L", 8800, "10000, 10000,", 5, "", "Textured cotton", "A fitted waistcoat for weddings and festive days.", "Yes", "navy-waistcoat-1.jpg", "", "Sale"],
    note: "A DISCOUNT ONLY ON SOME SIZES. The old price (10000) is shown crossed out on S and M. The comma at the end leaves L without an old price. An old price must always be higher than the price.",
  },
  {
    cells: ["Tan Leather Wallet", "Accessories", "Wallets", "", "", "Wallet", "Tan", "One size", 3500, 4500, 20, "", "Leather", "Slim bifold wallet in genuine leather.", "Yes", "tan-wallet.jpg", "", "Sale"],
    note: "A PRODUCT WITHOUT SIZES. Type One size (or leave the Size cell empty). The old price 4500 shows the discount.",
  },
  {
    cells: ["Classic Cotton Shirt", "Shirts", "Formal Shirts", "", "", "Shirt", "White", "14.5, 15.5, 16.5", 6800, "", 3, "FOR-121", "Cotton", "A classic cotton shirt for the office.", "Yes", "classic-cotton-white-1.jpg, classic-cotton-white-2.jpg", "", ""],
    note: "TWO COLOURS OF ONE SHIRT (1 of 2). Same product name, a different colour on each row: the website puts them on ONE page and the shopper swipes between the colours. Each colour has its own article number and its own photos.",
  },
  {
    cells: ["Classic Cotton Shirt", "Shirts", "Formal Shirts", "", "", "Shirt", "Pink", "14.5, 15.5, 16.5", 6800, "", 3, "FOR-111", "Cotton", "", "Yes", "classic-cotton-pink-1.jpg, classic-cotton-pink-2.jpg", "", ""],
    note: "TWO COLOURS OF ONE SHIRT (2 of 2). The same name with the colour Pink. The description and fabric are written once, on the first colour; later rows may leave them empty.",
  },
  {
    cells: ["Plaid Check Shirt", "Shirts", "Formal Shirts", "", "", "Shirt", "Beige", "14.5, 14.5 (SLIM), 15.5, 15.5 (SLIM)", 14500, "", 1, "FOR-132", "Cotton", "A refined tartan-style check that stands out in the office.", "Yes", "plaid-check-beige-1.jpg", "", "New"],
    note: "YOUR OWN ARTICLE NUMBER. Type FOR-132 once: we give every size its own code made from it (FOR-132-14.5, FOR-132-14.5-SLIM, FOR-132-15.5 …). Slim sizes are just sizes with (SLIM) written after the number.",
  },
  {
    cells: ["Wing Collar Tuxedo Shirt", "Shirts", "Formal Shirts", "", "", "Shirt", "White", "14.5", 6800, "", 1, "FOR-134", "Cotton", "A tuxedo shirt with a wing collar for formal evenings.", "Yes", "wing-collar-tuxedo-1.jpg", "", ""],
    note: "THE OTHER WAY, ONE ROW FOR EACH SIZE (1 of 2). It works too, and can be mixed with the easy way. Copy the name, category, type and colour down on every row.",
  },
  {
    cells: ["Wing Collar Tuxedo Shirt", "Shirts", "Formal Shirts", "", "", "Shirt", "White", "15.5", 6800, "", 2, "FOR-134", "", "", "Yes", "", "", ""],
    note: "ONE ROW FOR EACH SIZE (2 of 2). Same name and colour, the next size. The article number FOR-134 is typed again; each size gets its own code (FOR-134-14.5, FOR-134-15.5).",
  },
  {
    cells: ["Grey Linen Safari Suit", "Safari Suits", "", "", "", "Safari Suit", "Grey", "M, L, XL", 15500, "", 2, "", "Linen", "A relaxed linen safari suit.", "No", "grey-linen-safari-1.jpg", "", ""],
    note: "NOT ON THE WEBSITE YET. “Show on website?” = No: the product is saved but customers cannot see it. Change it to Yes later on the Products page.",
  },
  {
    cells: ["Charcoal Overcoat", "Coats", "", "", "", "Overcoat", "Charcoal", "", "", "", "", "", "", "", "Yes", "charcoal-overcoat.jpg", "Yes", ""],
    note: "COMING SOON. Shown with its name, picture and a “Coming soon” badge, but it cannot be bought yet. Price, stock and sizes can stay empty.",
  },
  {
    cells: ["Heritage Wool Shawl", "Shawls", "", "", "", "Shawl", "Brown", "One size", "", "", 3, "", "Wool", "Told on WhatsApp.", "Yes", "heritage-shawl-1.jpg", "", ""],
    note: "PRICE ON REQUEST. Leave the Price cell EMPTY (or type On request). The shop shows “Price on request” instead of a price and the shopper asks on WhatsApp. Before the upload goes on, you see the list of products without a price and must agree to it, so a forgotten price is never silent.",
  },
];

/** The rows only (what the importer reads); the notes are for people. */
export const EXAMPLE_ROWS: unknown[][] = EXAMPLES.map((example) => example.cells);

/** "1 - How to fill": a short list of steps, then quick answers to the questions people really have. */
const GUIDE: Array<[string, "title" | "heading" | "text"]> = [
  ["How to add many products at once", "title"],
  ["1.  Open the sheet “2 - Your products”. Before you start, look at the sheet “3 - Example”: it has a row for every case, and the last column says what the row shows.", "text"],
  ["2.  Use ONE ROW FOR EACH COLOUR of a product. Type its name, category, type and colour.", "text"],
  ["3.  Sizes: click the Size cell and use the little arrow to pick a ready list (for example S, M, L, XL), or type your own sizes with commas:  14.5, 15, 15.5, 16.", "text"],
  ["4.  Stock and prices: ONE number counts for every size (Stock 3, Price 5800). When the sizes differ, type one number for each size in the same order, with a comma and a space after it:  Stock  3, 5, 2, 1   and   Price  5800, 5800, 6200, 6200.  The same works for the Old price. If the count does not fit the sizes, the upload tells you which row.", "text"],
  ["5.  Same product in another colour? Add another row with the SAME product name and the new colour. The website puts the colours on one page: the shopper swipes through the photos and the colour, price and sizes follow. Put each colour's photo names on that colour's row.", "text"],
  ["6.  Product code is YOUR article number, easy to remember. Leave it empty and we make one. Typing one code for the whole product (FOR-132) is fine too: each size then gets its own, like FOR-132-14.5 and FOR-132-15.5. Two different products must not share a code.", "text"],
  ["7.  Columns with a * are needed. The others you can leave empty. Fabric and Description are one text for the colour (write it on the first row of that colour; do not split it with commas).", "text"],
  ["8.  Category, Type and Yes/No have a little arrow: click the cell and pick from the list. Categories inside categories are optional: Category = Shirts, Subcategory = Formal Shirts, Sub-subcategory = Business Formal Shirts (then Level 4 if you need one). Fill them from left to right, copy them down on every row of the product, and a name that is new makes a new folder on the website. The product goes in the last one you fill.", "text"],
  ["9.  Photos: write the picture file names in “Photo file names” (for example olive-cargo-1.jpg). You choose the pictures on the website in the next step. The first name is the main photo.", "text"],
  ["10. Save this file and upload it on the website: Products → Add many with Excel. We check everything first and tell you the row of every mistake, so nothing goes wrong.", "text"],
  ["", "text"],
  ["Quick answers", "heading"],
  ["•  One shirt, four sizes, the same price and the same stock   →   Size: 14.5, 15.5, 16.5, 17.5    Price: 5800    Stock: 3", "text"],
  ["•  The stock is different for each size   →   Stock: 3, 5, 2, 1     (the first number is for the first size, and so on)", "text"],
  ["•  The price is different for some sizes   →   Price: 5800, 5800, 6200, 6200", "text"],
  ["•  A discount only on some sizes   →   Old price: 7000, 7000,     (the comma at the end leaves the last size without a discount)", "text"],
  ["•  A product with no sizes (wallet, belt)   →   Size: One size    (or leave the Size cell empty)", "text"],
  ["•  The same shirt in another colour   →   a new row with the same product name and the new colour", "text"],
  ["•  My own article number (FOR-132)   →   type it in Product code. Every size gets its own: FOR-132-14.5, FOR-132-15.5 …", "text"],
  ["•  Slim fit sizes   →   write them as sizes:  14.5, 14.5 (SLIM), 15.5, 15.5 (SLIM)", "text"],
  ["•  I do not want it on the website yet   →   Show on website?: No", "text"],
  ["•  The price is told on WhatsApp   →   leave Price EMPTY (or type On request). The shop shows “Price on request”. The upload lists these products and asks you to agree.", "text"],
  ["•  Not ready to sell, only to show   →   Coming soon?: Yes     (price, stock and sizes can stay empty)", "text"],
  ["•  Writing a thousand   →   type 1000. With one size, 1,000 also works; with several sizes always write 1000 without the comma.", "text"],
  ["•  “3 sizes but 2 prices” on upload   →   the numbers in that cell do not match the sizes. Type one number for all, or one for each size.", "text"],
  ["", "text"],
  ["Using Google Sheets? Open this file in Google Sheets (File → Import), fill it in, then File → Download → Microsoft Excel (.xlsx). Upload that file.", "text"],
  ["Prices are in rupees, numbers only (6500, not Rs. 6,500/-). Do not change the titles in the first row.", "text"],
];

/** Makes the whole workbook with the given Excel library (ExcelJS in the browser, or the Node package in the script). */
export function buildProductWorkbook(ExcelJS: ExcelJSLike, categories: string[]) {
  const wb = new ExcelJS.Workbook();

  // 1. How to fill it
  const guide = wb.addWorksheet("1 - How to fill");
  guide.columns = [{ width: 4 }, { width: 110 }];
  GUIDE.forEach(([text, kind], index) => {
    const cell = guide.getCell(`B${index + 1}`);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
    cell.font = kind === "title" ? { bold: true, size: 16, color: { argb: GREEN } } : kind === "heading" ? { bold: true, size: 14, color: { argb: GREEN } } : { size: 12 };
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

  // 3. Examples (the last column is for the reader; the importer ignores columns it does not know)
  const example = wb.addWorksheet("3 - Example");
  example.columns = [...SHEET_COLUMNS.map((col) => ({ width: col.width })), { width: 80 }];
  SHEET_COLUMNS.forEach((col, index) => {
    example.getRow(1).getCell(index + 1).value = col.label;
  });
  example.getRow(1).getCell(SHEET_COLUMNS.length + 1).value = "What this row shows";
  styleHeader(example, SHEET_COLUMNS.length + 1);
  example.getRow(1).getCell(SHEET_COLUMNS.length + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
  EXAMPLES.forEach(({ cells, note }) => {
    const row = example.addRow([...cells, note]);
    const noteCell = row.getCell(SHEET_COLUMNS.length + 1);
    noteCell.alignment = { wrapText: true, vertical: "top" };
    noteCell.font = { italic: true, color: { argb: GREY } };
  });

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
  return wb;
}
