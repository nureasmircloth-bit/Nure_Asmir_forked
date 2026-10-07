import { expect, test } from "@playwright/test";
import { BASE, warmUp } from "../support/helpers";

/** What search engines read: headings, trail, indexing rules, structured data, sitemap. Checked on the real built pages. */
test.describe("SEO structure", () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/", "/shop", "/about", "/contact", "/faq", "/policies/returns", "/collections/shirts", "/cart", "/checkout", "/track-order"]);
  });

  const html = async (request: import("@playwright/test").APIRequestContext, path: string) => (await request.get(`${BASE}${path}`)).text();
  const types = (page: string) => new Set([...page.matchAll(/"@type":"([A-Za-z]+)"/g)].map((m) => m[1]));

  test("every public page has exactly one main heading, a language and a canonical address", async ({ request }) => {
    for (const path of ["/", "/shop", "/about", "/contact", "/faq", "/policies/returns", "/collections/shirts"]) {
      const page = await html(request, path);
      expect((page.match(/<h1[\s>]/g) ?? []).length, `${path} needs exactly one <h1>`).toBe(1);
      expect(page, path).toContain('<html lang="en-PK"');
      expect(page, `${path} canonical`).toMatch(/<link rel="canonical" href="[^"]+"/);
    }
  });

  test("inner pages show a visible trail and publish it as structured data", async ({ request }) => {
    for (const [path, last] of [["/shop", "Shop"], ["/about", "Our story"], ["/contact", "Contact"], ["/faq", "FAQ"], ["/policies/returns", "Returns"]] as const) {
      const page = await html(request, path);
      expect(page, `${path} visible trail`).toMatch(/<nav class="breadcrumb" aria-label="Breadcrumb">/);
      expect(page, `${path} trail ends with ${last}`).toContain(last);
      expect(types(page).has("BreadcrumbList"), `${path} BreadcrumbList`).toBe(true);
    }
    expect(types(await html(request, "/about")).has("AboutPage")).toBe(true);
    expect(types(await html(request, "/contact")).has("ContactPage")).toBe(true);
  });

  test("lists of products say so: shop and category pages carry an ItemList", async ({ request }) => {
    for (const path of ["/shop", "/collections/shirts"]) {
      const page = await html(request, path);
      expect(types(page).has("ItemList"), path).toBe(true);
      expect(types(page).has("CollectionPage"), path).toBe(true);
    }
  });

  test("steps of buying are marked noindex and left out of the sitemap; public pages stay indexable", async ({ request }) => {
    for (const path of ["/cart", "/checkout", "/track-order"]) expect(await html(request, path), path).toMatch(/<meta name="robots" content="noindex/);
    for (const path of ["/", "/shop", "/about", "/faq"]) expect(await html(request, path), path).not.toMatch(/content="noindex/);
    const sitemap = await (await request.get(`${BASE}/sitemap.xml`)).text();
    expect(sitemap).not.toContain("/track-order");
    expect(sitemap).not.toContain("/cart");
    expect(sitemap).not.toContain("/checkout");
    expect(sitemap).toContain("/shop");
    const robots = await (await request.get(`${BASE}/robots.txt`)).text();
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });

  test("an unknown address is a real 404 that search engines are told to ignore", async ({ request }) => {
    const response = await request.get(`${BASE}/definitely-not-a-page-${Date.now()}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).toMatch(/<meta name="robots" content="noindex/);
  });

  test("meta descriptions are full sentences, not a bare name", async ({ request }) => {
    for (const path of ["/", "/collections/shirts", "/collections/pants"]) {
      const description = /<meta name="description" content="([^"]*)"/.exec(await html(request, path))?.[1] ?? "";
      expect(description.length, `${path}: "${description}"`).toBeGreaterThanOrEqual(70);
      expect(description.length, path).toBeLessThanOrEqual(170);
    }
  });

  test("the pages do not depend on outside picture hosts for flags", async ({ request }) => {
    expect(await html(request, "/")).not.toContain("flagcdn.com");
  });
});
