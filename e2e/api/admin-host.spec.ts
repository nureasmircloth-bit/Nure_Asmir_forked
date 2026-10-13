import { expect, test } from "@playwright/test";

/**
 * One deployment answers every hostname (shop, admin, training). On the admin hostname the bare address and any non-admin page go to the
 * admin panel, so staff never have to type /admin; on the shop hostname nothing changes.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

test.describe("admin hostname", () => {
  const admin = { host: "admin.nureasmir.com" };

  test("the bare address opens the admin, /login opens its sign-in, and other pages are taken into /admin", async ({ request }) => {
    const root = await request.get(`${BASE}/`, { headers: admin, maxRedirects: 0 });
    expect([307, 308]).toContain(root.status());
    expect(new URL(root.headers().location, BASE).pathname).toBe("/admin");

    const login = await request.get(`${BASE}/login`, { headers: admin, maxRedirects: 0 });
    expect([307, 308]).toContain(login.status());
    expect(new URL(login.headers().location, BASE).pathname).toBe("/admin/login");

    const other = await request.get(`${BASE}/orders`, { headers: admin, maxRedirects: 0 });
    expect([307, 308]).toContain(other.status());
    expect(new URL(other.headers().location, BASE).pathname).toBe("/admin/orders");
  });

  test("the admin hostname is never indexed, and its API and files are left alone", async ({ request }) => {
    const health = await request.get(`${BASE}/api/health`, { headers: admin, maxRedirects: 0 });
    expect(health.status()).toBe(200); // not redirected into /admin
    expect(health.headers()["x-robots-tag"] ?? "").toMatch(/noindex/);
    const file = await request.get(`${BASE}/robots.txt`, { headers: admin, maxRedirects: 0 });
    expect(file.status(), "a path with a dot is a file, not a page").not.toBe(307);
  });

  test("the shop hostname is untouched: the home page is the shop, indexable, with no redirect", async ({ request }) => {
    const home = await request.get(`${BASE}/`, { maxRedirects: 0, timeout: 90_000 }); // the first visit makes the dev server compile the home page
    expect(home.status()).toBe(200);
    expect(home.headers()["x-robots-tag"] ?? "").not.toMatch(/noindex/);
  });
});
