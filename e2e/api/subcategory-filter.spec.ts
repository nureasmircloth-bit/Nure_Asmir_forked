import { expect, test } from "@playwright/test";
import { BASE, sql, variantBySku } from "../support/helpers";

/** A product's subcategory (set by the Excel import's Subcategory column) is what the category page's chips filter by, even when the word is not in its name. */
test("a product is found by its subcategory word", async ({ request }) => {
  const variant = await variantBySku("NA-TE-SAS-M");
  const [row] = (await sql`select subcategory from products where id = ${variant.productId}`) as Array<{ subcategory: string | null }>;
  const word = "Zzzfilterword";
  try {
    await sql`update products set subcategory = ${word} where id = ${variant.productId}`;
    const found = (await (await request.get(`${BASE}/api/catalog/page?cat=all&sort=newest&page=1&q=${word}`)).json()) as { products: Array<{ id: string }> };
    expect(found.products.map((p) => p.id)).toEqual([variant.productId]);
    const none = (await (await request.get(`${BASE}/api/catalog/page?cat=all&sort=newest&page=1&q=Zzznothere`)).json()) as { products: unknown[] };
    expect(none.products).toHaveLength(0);
  } finally {
    await sql`update products set subcategory = ${row?.subcategory ?? null} where id = ${variant.productId}`;
  }
});
