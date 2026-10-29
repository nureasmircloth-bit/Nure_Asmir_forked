import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE, sql, variantBySku } from "../support/helpers";

/** A category page lists its own products and those of every category inside it, however deep; a sibling's products stay out. */
test("a parent category lists the products of the categories inside it", async ({ request }) => {
  const variant = await variantBySku("NA-TE-SAS-M");
  const [before] = (await sql`select category_id from products where id = ${variant.productId}`) as Array<{ category_id: string }>;
  const ids = { top: randomUUID(), middle: randomUUID(), leaf: randomUUID(), sibling: randomUUID() };
  const slugs = { top: `zz-tree-top-${Date.now()}`, middle: `zz-tree-middle-${Date.now()}`, leaf: `zz-tree-leaf-${Date.now()}`, sibling: `zz-tree-sibling-${Date.now()}` };
  try {
    await sql`insert into categories (id, name, slug, status, sort_order) values (${ids.top}, 'Zz Top', ${slugs.top}, 'active', 90)`;
    await sql`insert into categories (id, name, slug, parent_id, status, sort_order) values (${ids.middle}, 'Zz Middle', ${slugs.middle}, ${ids.top}, 'active', 1)`;
    await sql`insert into categories (id, name, slug, parent_id, status, sort_order) values (${ids.leaf}, 'Zz Leaf', ${slugs.leaf}, ${ids.middle}, 'active', 1)`;
    await sql`insert into categories (id, name, slug, parent_id, status, sort_order) values (${ids.sibling}, 'Zz Sibling', ${slugs.sibling}, ${ids.top}, 'active', 2)`;
    await sql`update products set category_id = ${ids.leaf} where id = ${variant.productId}`;

    const listed = async (slug: string) =>
      ((await (await request.get(`${BASE}/api/catalog/page?cat=${slug}&sort=newest&page=1`)).json()) as { products: Array<{ id: string }> }).products.map((p) => p.id);

    expect(await listed(slugs.leaf)).toContain(variant.productId);
    expect(await listed(slugs.middle)).toContain(variant.productId);
    expect(await listed(slugs.top)).toContain(variant.productId);
    expect(await listed(slugs.sibling)).not.toContain(variant.productId);

    // the storefront page of the leaf shows the whole trail above it
    const html = await (await request.get(`${BASE}/collections/${slugs.leaf}`)).text();
    expect(html).toContain("Zz Top");
    expect(html).toContain("Zz Middle");
    expect(html).toContain(`/collections/${slugs.top}`);
    // and the top page offers the categories inside it
    const topHtml = await (await request.get(`${BASE}/collections/${slugs.top}`)).text();
    expect(topHtml).toContain(`/collections/${slugs.middle}`);
    expect(topHtml).toContain(`/collections/${slugs.sibling}`);
  } finally {
    await sql`update products set category_id = ${before.category_id} where id = ${variant.productId}`;
    await sql`delete from categories where id in (${ids.leaf}, ${ids.sibling})`;
    await sql`delete from categories where id = ${ids.middle}`;
    await sql`delete from categories where id = ${ids.top}`;
  }
});
