import { expect, test } from "@playwright/test";
import { BASE, sql } from "../support/helpers";

/**
 * On a line that sometimes loses the first packet to a new address, every extra website a page needs on the first visit is another chance for a
 * 1-3 second stall. The home page must only need our own address (the built-in fonts are served by us).
 */
test.describe("first visit: as few outside websites as possible", () => {
  test("with the built-in fonts, the home and shop pages ask no outside host for fonts or styles", async ({ request }) => {
    await sql`update site_settings set font_family = 'Cormorant Garamond', body_font_family = 'Figtree', contact_font_family = 'Inter' where id = 'store'`;
    for (const path of ["/", "/shop", "/about"]) {
      const html = await (await request.get(`${BASE}${path}`, { timeout: 90_000 })).text();
      expect(html, path).not.toContain("fonts.googleapis.com");
      expect(html, path).not.toContain("fonts.gstatic.com");
    }
  });
  test("the contact page asks for its own font, and only the contact page does", async ({ request }) => {
    await sql`update site_settings set font_family = 'Cormorant Garamond', body_font_family = 'Figtree', contact_font_family = 'Inter' where id = 'store'`;
    const contact = await (await request.get(`${BASE}/contact`, { timeout: 90_000 })).text();
    expect(contact).toMatch(/fonts\.googleapis\.com\/css2\?family=Inter/);
    const home = await (await request.get(`${BASE}/`)).text();
    expect(home).not.toMatch(/family=Inter/);
  });
});
