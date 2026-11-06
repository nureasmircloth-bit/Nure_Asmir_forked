// Writes the product sheet the admin offers under Products → Add many with Excel, as a file.
// Usage: npx tsx scripts/make-product-sheet.ts [output.xlsx] [Category,Category,…]
// The workbook is built by lib/product-sheet-workbook.ts, the same code the website uses, so this file is always what the owner would download.

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { buildProductWorkbook } from "../lib/product-sheet-workbook";
import type { ExcelJSLike } from "../lib/sheet-client";

const out = path.resolve(process.argv[2] ?? "sample/Nure-Asmir-products-sheet.xlsx");
const categories = (process.argv[3] ?? "Shirts,Pants,Shalwar Kameez,Accessories,Waistcoats,Safari Suits,Coats").split(",").map((name) => name.trim()).filter(Boolean);

async function main() {
  const wb = buildProductWorkbook(ExcelJS as unknown as ExcelJSLike, categories) as unknown as { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await wb.xlsx.writeBuffer()));
  console.log(`Written ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
