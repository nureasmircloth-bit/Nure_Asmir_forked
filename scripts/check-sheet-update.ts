// Tries "upload a sheet for products that already exist" against a throw-away local database: LOCAL_DB_PATH=<file> node ./node_modules/tsx/dist/cli.mjs scripts/check-sheet-update.ts
import { db } from "@/db";
import { productVariants } from "@/db/schema";
import { importOne } from "@/lib/import/import-product";
import { planSheetUpdate } from "@/lib/import/sheet-update";
import { planChanges } from "@/lib/mcp/manage-tools";
import { eq } from "drizzle-orm";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) { failures++; if (detail !== undefined) console.log(JSON.stringify(detail, null, 1)); } };

async function main() {
  if (!process.env.LOCAL_DB_PATH) { console.error("Set LOCAL_DB_PATH to a throw-away SQLite file first."); process.exit(2); }
  const sizes = ["S", "M", "L"].map((size) => ({ name: `Navy / ${size}`, color: "Navy", sku: `CW-${size}`, size, price: 8000, stockQuantity: 5 }));
  const made = await importOne({ name: "Classic Waistcoat", category: "Waistcoats", typeLabel: "Waistcoat", visibility: "draft", variants: sizes } as never, 0);
  const productId = made.productId!;
  const sheet = [{ name: "Classic Waistcoat", colour: "Navy", variants: ["S", "M", "L", "XL"].map((size) => ({ size, price: 8000, oldPrice: null, stock: size === "XL" ? 9 : 5 })) }, { name: "Brand New Product", colour: "Red", variants: [{ size: "M", price: 100, oldPrice: null, stock: 1 }] }];

  const first = await planSheetUpdate(sheet, { updateExisting: false });
  check("existing product is recognised, the new one is left to the normal upload", first.existing.length === 1 && first.existing[0] === "Classic Waistcoat", first);
  check("only the new size XL becomes a change", first.changes.length === 1 && first.changes[0].addSizes === "XL" && first.changes[0].stock === 9, first.changes);
  const planned = await planChanges(first.changes);
  check("the planner accepts it and says what it adds", planned.problems.length === 0 && planned.plans.length === 1 && /XL/.test(planned.plans[0].what.join()), planned.problems);
  for (const item of planned.plans) await item.apply();
  const after = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  check("XL was added to the existing product (4 sizes, no second product)", after.length === 4 && after.some((v) => v.size === "XL" && v.stockQuantity === 9 && v.price === 8000), after.map((v) => [v.sku, v.size]));

  const again = await planSheetUpdate(sheet, { updateExisting: false });
  check("uploading the same sheet again changes nothing (no duplicates)", again.changes.length === 0, again.changes);

  const changed = sheet.map((entry) => ({ ...entry, variants: entry.variants.map((v) => (v.size === "M" ? { ...v, price: 9000, stock: 2 } : v)) }));
  const off = await planSheetUpdate(changed, { updateExisting: false });
  check("without the update box, existing sizes are left alone", off.changes.length === 0, off.changes);
  const on = await planSheetUpdate(changed, { updateExisting: true });
  check("with the update box, only the size that differs changes", on.changes.length === 1 && on.changes[0].price === 9000 && on.changes[0].stock === 2, on.changes);
  const onPlan = await planChanges(on.changes);
  for (const item of onPlan.plans) await item.apply();
  const m = (await db.select().from(productVariants).where(eq(productVariants.productId, productId))).find((v) => v.size === "M")!;
  check("price and stock of M were updated", m.price === 9000 && m.stockQuantity === 2, m);

  const newColour = await planSheetUpdate([{ name: "Classic Waistcoat", colour: "Maroon", variants: [{ size: "M", price: 1, oldPrice: null, stock: 1 }] }], { updateExisting: true });
  check("a colour that is new for an existing product is reported, not guessed", newColour.changes.length === 0 && newColour.notes.some((n) => /no colour Maroon/.test(n)), newColour);
  const onRequest = await planSheetUpdate([{ name: "Classic Waistcoat", colour: "Navy", variants: [{ size: "L", price: 0, oldPrice: null, stock: 5 }] }], { updateExisting: true });
  check("a price on request in the sheet keeps the shop's price", onRequest.changes.length === 0, onRequest.changes);
  const cased = await planSheetUpdate([{ name: "  classic WAISTCOAT ", colour: "NAVY", variants: [{ size: "xs", price: 8000, oldPrice: null, stock: 1 }] }], { updateExisting: false });
  check("names, colours and sizes match without regard to capitals or spaces", cased.existing.length === 1 && cased.changes.length === 1, cased);
  console.log(failures ? `${failures} FAILED` : "ALL OK");
  process.exit(failures ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(2); });
