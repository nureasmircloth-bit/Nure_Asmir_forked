import { expect, test } from "@playwright/test";
import { adminCookie, BASE, sql } from "../support/helpers";

/** Categories inside categories, made by the admin API and by the Excel import (a path written with > between the names). */
test("admin: nested categories are created, cannot loop, and a path in the sheet makes every level", async ({ request }) => {
  await adminCookie(request);
  const stamp = Date.now();
  const made: string[] = [];
  try {
    const top = (await (await request.post(`${BASE}/api/admin/categories`, { data: { name: `Zz Tree ${stamp}` } })).json()) as { category: { id: string } };
    made.push(top.category.id);
    const inner = await request.post(`${BASE}/api/admin/categories`, { data: { name: `Zz Inner ${stamp}`, parentId: top.category.id } });
    expect(inner.status()).toBe(201);
    const innerRow = ((await inner.json()) as { category: { id: string; parentId: string } }).category;
    made.push(innerRow.id);
    expect(innerRow.parentId).toBe(top.category.id);

    // a parent that does not exist is refused, and so is putting a category inside itself or inside one of its own
    expect((await request.post(`${BASE}/api/admin/categories`, { data: { name: `Zz Lost ${stamp}`, parentId: "00000000-0000-0000-0000-000000000000" } })).status()).toBe(400);
    expect((await request.patch(`${BASE}/api/admin/categories/${top.category.id}`, { data: { parentId: innerRow.id } })).status()).toBe(400);
    expect((await request.patch(`${BASE}/api/admin/categories/${top.category.id}`, { data: { parentId: top.category.id } })).status()).toBe(400);

    // the Excel import: a path creates each level once and puts the product in the last one
    const path = `Zz Tree ${stamp} > Zz Inner ${stamp} > Zz Leaf ${stamp}`;
    const body = { name: `Zz Path Shirt ${stamp}`, category: path, typeLabel: "Shirt", variants: [{ color: "White", sku: `ZZ-PATH-${stamp}`, price: 1000, stockQuantity: 1 }] };
    const imported = await request.post(`${BASE}/api/admin/products/import`, { data: body });
    expect(imported.status()).toBeLessThan(300);
    const leaves = (await sql`select id, parent_id from categories where name = ${`Zz Leaf ${stamp}`}`) as Array<{ id: string; parent_id: string }>;
    expect(leaves).toHaveLength(1);
    expect(leaves[0].parent_id).toBe(innerRow.id);
    made.push(leaves[0].id);
    // a plain name that two branches share is not guessed: the owner is asked for the whole path
    const dup = `Zz Dup ${stamp}`;
    for (const parent of [`Zz A ${stamp}`, `Zz B ${stamp}`]) await request.post(`${BASE}/api/admin/categories`, { data: { name: `${parent} > ${dup}` } });
    const ambiguous = await request.post(`${BASE}/api/admin/products/import`, { data: { ...body, name: `Zz Path Shirt Three ${stamp}`, category: dup, variants: [{ ...body.variants[0], sku: `ZZ-PATH3-${stamp}` }] } });
    expect(JSON.stringify(await ambiguous.json())).toContain("whole path");
    await sql`delete from categories where name = ${dup}`;
    await sql`delete from categories where name in (${`Zz A ${stamp}`}, ${`Zz B ${stamp}`})`;
    // the same path again finds the same categories (nothing is duplicated)
    await request.post(`${BASE}/api/admin/products/import`, { data: { ...body, name: `Zz Path Shirt Two ${stamp}`, variants: [{ ...body.variants[0], sku: `ZZ-PATH2-${stamp}` }] } });
    const count = (await sql`select count(*) as n from categories where name like ${`Zz % ${stamp}`}`) as Array<{ n: number }>;
    expect(Number(count[0].n)).toBe(3);
  } finally {
    await sql`delete from product_variants where sku like ${`ZZ-PATH%-${stamp}`}`;
    await sql`delete from products where name like ${`Zz Path Shirt%${stamp}`}`;
    await sql`delete from categories where name = ${`Zz Leaf ${stamp}`}`;
    for (const id of made.reverse()) await sql`delete from categories where id = ${id}`;
  }
});
