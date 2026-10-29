import { expect, request as playwrightRequest, test } from "@playwright/test";
import { BASE, freshIp, placeOrder, sql, variantBySku } from "../support/helpers";

/**
 * "Coming soon" products are shown (name, picture, badge) but can never be bought; and a product form that names a new category creates it, with its
 * optional subcategory added to the category's list. Everything the test changes is put back.
 */
const SKU = "NA-TE-SAS-M";

test.describe("coming soon and typed categories", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "one desktop browser is enough");
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("a coming-soon product is listed as such and cannot be put in a bag or ordered", async ({ request, page }) => {
    const variant = await variantBySku(SKU);
    const [row] = (await sql`select slug, coming_soon from products where id = ${variant.productId}`) as Array<{ slug: string; coming_soon: number }>;
    try {
      await sql`update products set coming_soon = 1 where id = ${variant.productId}`;
      const listed = (await (await request.get(`${BASE}/api/catalog/page?cat=all&sort=newest&page=1`)).json()) as { products: Array<{ id: string; comingSoon?: boolean }> };
      expect(listed.products.find((p) => p.id === variant.productId)?.comingSoon).toBe(true);

      await page.goto(`/products/${row.slug}`);
      await expect(page.locator(".product-price")).toHaveText("Coming soon");
      await expect(page.getByRole("button", { name: "Coming soon" })).toBeDisabled();
      await expect(page.getByRole("button", { name: /Add to bag/ })).toHaveCount(0);

      const availability = (await (await request.post(`${BASE}/api/cart-availability`, { data: { variantIds: [variant.id] } })).json()) as { availability: Array<{ live?: boolean; available: number }> };
      expect(availability.availability[0].available).toBe(0);

      const placed = await placeOrder(request, { items: [{ variantId: variant.id, quantity: 1 }] });
      expect(placed.status).toBe(409);
      expect(String(placed.body.error)).toMatch(/coming soon/i);
    } finally {
      await sql`update products set coming_soon = ${row.coming_soon} where id = ${variant.productId}`;
    }
  });

  test("typing a new category and subcategory in the product form creates them; an existing one is reused", async () => {
    const email = process.env.E2E_ADMIN_EMAIL!;
    const password = process.env.E2E_ADMIN_PASSWORD!;
    await sql`delete from login_attempts where lower(email) = lower(${email})`;
    const admin = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
    expect((await admin.post("/api/admin/login", { data: { email, password } })).status()).toBe(200);
    const name = "E2E Typed Category";
    try {
      const make = (productName: string, categoryName: string, subcategory: string | null) =>
        admin.post("/api/admin/products", { data: { name: productName, categoryName, typeLabel: "Jacket", subcategory, status: "draft" } });
      const first = await make("E2E Typed One", name, "Winter");
      expect(first.status()).toBe(201);
      const second = await make("E2E Typed Two", name.toUpperCase(), "winter"); // same words, other capitals: the same category and the same subcategory
      expect(second.status()).toBe(201);
      const third = await make("E2E Typed Three", name, null); // a subcategory is optional
      expect(third.status()).toBe(201);
      const fourth = await make("E2E Typed Four", name, "Spring");
      expect(fourth.status()).toBe(201);

      const cats = (await sql`select id, name, subcategories from categories where lower(name) = lower(${name})`) as Array<{ id: string; name: string; subcategories: string | null }>;
      expect(cats).toHaveLength(1);
      expect(cats[0].subcategories).toBe("Winter, Spring");
      const made = (await sql`select name, subcategory, category_id from products where name like ${"E2E Typed%"} order by name`) as Array<{ name: string; subcategory: string | null; category_id: string }>;
      expect(made.map((p) => [p.name, p.subcategory])).toEqual([["E2E Typed Four", "Spring"], ["E2E Typed One", "Winter"], ["E2E Typed Three", null], ["E2E Typed Two", "winter"]]);
      expect(new Set(made.map((p) => p.category_id))).toEqual(new Set([cats[0].id]));

      // no category at all is refused
      expect((await admin.post("/api/admin/products", { data: { name: "E2E Typed None", typeLabel: "Jacket" } })).status()).toBe(400);
    } finally {
      await sql`delete from products where name like ${"E2E Typed%"}`;
      await sql`delete from categories where lower(name) = lower(${name})`;
      await sql`delete from login_attempts where lower(email) = lower(${email})`;
    }
  });
});
