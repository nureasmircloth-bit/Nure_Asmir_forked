import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { sql, warmUp } from "../support/helpers";

/** Categories inside categories: the owner puts one inside another in Admin -> Collections, and the shopper opens them folder by folder in the menu. */
test.describe("category tree", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "one desktop browser is enough");
  test.describe.configure({ timeout: 240_000 });

  const stamp = Date.now();
  const child = { id: randomUUID(), name: `Zz Formal ${stamp}`, slug: `zz-formal-${stamp}` };
  const grandchild = { id: randomUUID(), name: `Zz Business ${stamp}`, slug: `zz-business-${stamp}` };
  let attempts: Array<Record<string, unknown>> = [];

  test.beforeAll(async ({ request }) => {
    expect(process.env.LOCAL_DB_PATH ?? "", "the app under test must use the local test database").toContain("e2e.sqlite");
    expect(process.env.D1_HTTP_DATABASE_ID ?? "", "no real D1 database may be configured").toBe("");
    attempts = await sql`select * from login_attempts where lower(email) = lower(${process.env.E2E_ADMIN_EMAIL!})`;
    const [shirts] = (await sql`select id from categories where slug = 'shirts'`) as Array<{ id: string }>;
    await sql`insert into categories (id, name, slug, parent_id, status, sort_order) values (${child.id}, ${child.name}, ${child.slug}, ${shirts.id}, 'active', 1)`;
    await sql`insert into categories (id, name, slug, parent_id, status, sort_order) values (${grandchild.id}, ${grandchild.name}, ${grandchild.slug}, ${child.id}, 'active', 1)`;
    await warmUp(request, ["/", "/admin/login", "/admin/collections"]);
  });
  test.afterAll(async () => {
    await sql`delete from categories where id = ${grandchild.id}`;
    await sql`delete from categories where id = ${child.id}`;
    await sql`delete from login_attempts where lower(email) = lower(${process.env.E2E_ADMIN_EMAIL!})`;
    for (const row of attempts) {
      await sql`insert into login_attempts (id, email, ip, success, created_at) values (${row.id as string}, ${row.email as string}, ${row.ip as string}, ${row.success as number}, ${row.created_at as number})`;
    }
  });

  async function login(page: Page) {
    await sql`delete from login_attempts where lower(email) = lower(${process.env.E2E_ADMIN_EMAIL!})`;
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  }

  test("the menu opens a category folder by folder, and the page shows the trail", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    // the categories inside Shirts are hidden until it is opened, and each level opens on its own
    await expect(menu.getByRole("link", { name: child.name })).toHaveCount(0);
    await menu.getByRole("button", { name: /Expand Shirts subcategories/ }).click();
    await expect(menu.getByRole("link", { name: child.name })).toBeVisible();
    await expect(menu.getByRole("link", { name: grandchild.name })).toHaveCount(0);
    await menu.getByRole("button", { name: `Expand ${child.name} subcategories` }).click();
    await menu.getByRole("link", { name: grandchild.name }).click();
    await expect(page).toHaveURL(new RegExp(`/collections/${grandchild.slug}$`));
    const trail = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(trail).toContainText(`Shirts`);
    await expect(trail).toContainText(child.name);
    await expect(trail).toContainText(grandchild.name);
    // the homepage and footer list only the top-level categories
    await page.goto("/");
    await expect(page.getByRole("link", { name: child.name })).toHaveCount(0);
  });

  test("the owner sees the folder tree and can move a category", async ({ page }) => {
    await login(page);
    await page.goto("/admin/collections");
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    const row = page.locator("tr", { has: page.locator(`input[name="slug"][value="${grandchild.slug}"]`) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('select[name="parentId"]')).toHaveValue(child.id);
    await expect(row).toContainText("Shirts");
    // a category cannot be offered a place inside itself or its own categories
    const options = await row.locator('select[name="parentId"] option').allTextContents();
    expect(options.some((text) => text.includes(grandchild.name))).toBe(false);
    // move it to the top level
    await row.locator('select[name="parentId"]').selectOption("");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /updated/i }).first()).toBeVisible({ timeout: 20_000 });
    const [moved] = (await sql`select parent_id from categories where id = ${grandchild.id}`) as Array<{ parent_id: string | null }>;
    expect(moved.parent_id).toBeNull();
  });
});
