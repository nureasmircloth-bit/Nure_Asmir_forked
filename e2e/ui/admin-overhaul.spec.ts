import { expect, test, type Page } from "@playwright/test";
import { BASE, cleanOrders, orderIdOf, placeOrder, setStock, sql, variantBySku, warmUp } from "../support/helpers";

test.describe("admin: top bar, delivery, payment, questions", () => {
  test.skip(({ browserName, isMobile, viewport }) => browserName !== "chromium" || isMobile || (viewport?.width ?? 0) < 1000, "admin UI is exercised on desktop Chromium");
  test.describe.configure({ timeout: 240_000 });

  async function login(page: Page) {
    await sql`delete from login_attempts`;
    await page.goto("/admin/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  }
  const toast = (page: Page) => page.locator(".a-toast");
  // Saved settings wait in a 5-minute safety buffer before the shop sees them; the tests press "apply now" instead of waiting.
  const applyNow = async (page: Page) => {
    // makes sure the saved settings are live (tests run with the safety buffer off; production waits 5 minutes unless 'Apply immediately' is pressed)
    await expect.poll(async () => {
      const res = await page.request.patch(`${BASE}/api/admin/settings`, { data: { action: "apply-now" } });
      return res.ok(); // with the buffer off in tests there is nothing waiting; this makes sure of it
    }, { timeout: 20_000 }).toBe(true);
  };
  const reset = () => sql`update site_settings set announcement_mode = 'auto', announcement_lines = '', delivery_mode = 'zones', flat_delivery_charge = 250, bank_deposit_enabled = false, free_delivery_threshold = 10000, pending_changes = null, pending_apply_at = null where id = 'store'`;

  test.beforeAll(async ({ request }) => {
    await warmUp(request, ["/api/admin/login", "/admin/login", "/shop", "/faq"]);
    await reset();
  });
  test.beforeEach(async () => {
    await reset();
  });
  test.afterAll(async () => {
    await reset();
    await cleanOrders();
    await sql`delete from faqs where question like 'E2E %'`;
  });

  test("Settings → Top bar: choose a mode, write your own lines, see a live preview, save – the website follows", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    const section = page.locator("section#topbar");
    await expect(section).toContainText("Cash on delivery available all over Pakistan"); // the automatic preview
    await expect(section).toContainText("Free delivery on orders above Rs. 10,000");

    await section.getByLabel(/Extra lines/).fill("E2E New arrivals every week\nE2E Eid collection is live");
    await expect(section.locator("ul li")).toHaveCount(4);
    await section.getByRole("radio", { name: /Only my own lines/ }).check();
    await expect(section.locator("ul li")).toHaveCount(2);
    await expect(section.locator("ul")).not.toContainText("Free delivery on orders above");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(toast(page).first()).toContainText("Settings saved", { timeout: 20_000 });
    await applyNow(page);
    await expect.poll(async () => (await (await page.request.get(`${BASE}/shop`)).text()).includes("E2E Eid collection is live"), { timeout: 30_000 }).toBe(true);

    await section.getByRole("radio", { name: /Hide the top bar/ }).check();
    await expect(section.getByLabel(/Your lines|Extra lines/)).toHaveCount(0);
    await expect(section).toContainText("The top bar is hidden.");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(toast(page).last()).toContainText("Settings saved", { timeout: 20_000 });
    await applyNow(page);
    await expect.poll(async () => (await (await page.request.get(`${BASE}/shop`)).text()).includes('class="announcement"'), { timeout: 30_000 }).toBe(false);
  });

  test("Settings → free delivery amount is the single source of truth: the top bar text, the checkout and the FAQ all follow it", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    await page.getByLabel(/Free delivery above/).fill("6500");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(toast(page).first()).toContainText("Settings saved", { timeout: 20_000 });
    await applyNow(page);
    await expect.poll(async () => { const t = await (await page.request.get(`${BASE}/shop`)).text(); const i = t.indexOf("Free delivery"); return i < 0 ? "none" : t.slice(i, i + 60); }, { timeout: 30_000 }).toContain("Free delivery on orders above Rs. 6,500");
    await sql`insert into faqs (question, answer, sort_order) values ('E2E Free amount?', 'Free above Rs. {{freeAbove}}.', 998) on conflict do nothing`;
    await expect.poll(async () => (await (await page.request.get(`${BASE}/faq`)).text()).includes("Free above Rs. 6,500."), { timeout: 30_000 }).toBe(true);
    // 0 = switched off: the bar stops promising it
    await page.getByLabel(/Free delivery above/).fill("0");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(toast(page).last()).toContainText("Settings saved", { timeout: 20_000 });
    await applyNow(page);
    await expect.poll(async () => (await (await page.request.get(`${BASE}/shop`)).text()).includes("Free delivery on orders above"), { timeout: 30_000 }).toBe(false);
  });

  test("Settings → delivery: pick how customers are charged, a flat price appears only when needed, bank transfer is an opt-in", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");
    const delivery = page.locator("section#delivery");
    await expect(delivery.getByRole("radio", { name: /A price for each area/ })).toBeChecked();
    await expect(delivery.getByLabel(/Delivery charge everywhere/)).toHaveCount(0);
    await expect(delivery.getByRole("checkbox", { name: /Also accept bank transfer/ })).not.toBeChecked();
    await expect(delivery).toContainText("customers can only choose cash on delivery");

    await delivery.getByRole("radio", { name: /One price everywhere/ }).check();
    await delivery.getByLabel(/Delivery charge everywhere/).fill("199");
    await delivery.getByRole("radio", { name: /Follow TCS prices/ }).check();
    await expect(delivery.getByLabel(/Delivery charge everywhere/)).toHaveCount(0);
    await delivery.getByRole("radio", { name: /One price everywhere/ }).check();
    await delivery.getByRole("checkbox", { name: /Also accept bank transfer/ }).check();
    await expect(delivery).toContainText("Customers can choose bank transfer");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(toast(page).first()).toContainText("Settings saved", { timeout: 20_000 });
    await applyNow(page);
    const [row] = (await sql`select delivery_mode as mode, flat_delivery_charge as flat, bank_deposit_enabled as bank from site_settings where id = 'store'`) as Array<Record<string, unknown>>;
    expect(row).toEqual({ mode: "flat", flat: 199, bank: 1 });

    // and the shop obeys: the checkout now offers bank transfer, with the flat price
    const options = (await (await page.request.get(`${BASE}/api/checkout/options`)).json()) as { settings: { bankDepositEnabled: boolean; deliveryMode: string; flatDeliveryCharge: number } };
    expect(options.settings).toMatchObject({ bankDepositEnabled: true, deliveryMode: "flat", flatDeliveryCharge: 199 });
    await page.reload();
    await expect(page.locator("section#delivery").getByRole("radio", { name: /One price everywhere/ })).toBeChecked();
    await expect(page.locator("section#delivery").getByRole("checkbox", { name: /Also accept bank transfer/ })).toBeChecked();
    await reset();
  });

  test("Settings: support email is editable, and the Contact page shows it instead of 'coming soon'", async ({ page }) => {
    await sql`update site_settings set support_email = '' where id = 'store'`;
    await login(page);
    await page.goto("/admin/settings");
    await page.getByLabel("Email address").fill("support@nureasmir.com");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(toast(page).first()).toContainText("Settings saved", { timeout: 20_000 });
    await applyNow(page);
    await page.goto(`${BASE}/contact`);
    await expect(page.getByRole("link", { name: "support@nureasmir.com" }).first()).toBeVisible();
  });

  test("Questions & answers: add, edit, reorder, hide, delete – each change shows on the FAQ page", async ({ page }) => {
    await sql`delete from faqs where question like 'E2E %'`;
    await login(page);
    await page.goto("/admin/faqs");
    await expect(page.getByRole("heading", { name: "Questions & answers" })).toBeVisible();
    await expect(page.getByText("Do you offer cash on delivery?")).toBeVisible(); // the starting set is there to edit

    await page.getByRole("button", { name: "Add a question" }).click();
    await page.getByLabel("Question", { exact: true }).fill("E2E Do you ship to Quetta?");
    await page.getByLabel("Answer").fill("Yes, in 3–5 days. Free above Rs. {{freeAbove}}.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("E2E Do you ship to Quetta?")).toBeVisible({ timeout: 15_000 });

    // an empty question is explained, not silently dropped
    await page.getByRole("button", { name: "Add a question" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Please type the question.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // edit
    const item = page.locator("li", { hasText: "E2E Do you ship to Quetta?" });
    await item.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Answer").fill("Yes, to Quetta in 3–5 working days.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Yes, to Quetta in 3–5 working days.")).toBeVisible({ timeout: 15_000 });

    // reorder: move it to the very top
    const rows = page.locator("section.a-card li");
    const position = async () => (await rows.allTextContents()).findIndex((text) => text.includes("E2E Do you ship to Quetta?"));
    for (let guard = 0; guard < 20 && (await position()) > 0; guard++) {
      const before = await position();
      await page.locator("li", { hasText: "E2E Do you ship to Quetta?" }).getByRole("button", { name: /Move .* up/ }).click();
      await expect.poll(position, { timeout: 10_000 }).toBe(before - 1);
    }
    await expect(page.locator("section.a-card li").first()).toContainText("E2E Do you ship to Quetta?");
    const publicFaq = async () => (await page.request.get(`${BASE}/faq`)).text();
    let html = await publicFaq();
    expect(html.indexOf("E2E Do you ship to Quetta?")).toBeLessThan(html.indexOf("Do you offer cash on delivery?"));
    expect(html).toContain("Yes, to Quetta in 3–5 working days.");

    // hide, then show again, then delete (with a confirmation)
    await page.locator("li", { hasText: "E2E Do you ship to Quetta?" }).getByRole("button", { name: "Hide" }).click();
    await expect(page.locator("li", { hasText: "E2E Do you ship to Quetta?" })).toContainText("Hidden");
    expect(await publicFaq()).not.toContain("E2E Do you ship to Quetta?");
    await page.locator("li", { hasText: "E2E Do you ship to Quetta?" }).getByRole("button", { name: "Show" }).click();
    await expect.poll(async () => (await publicFaq()).includes("E2E Do you ship to Quetta?")).toBe(true);

    await page.getByRole("button", { name: /Remove “E2E Do you ship to Quetta\?”/ }).click();
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByText("E2E Do you ship to Quetta?")).toBeVisible();
    await page.getByRole("button", { name: /Remove “E2E Do you ship to Quetta\?”/ }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("E2E Do you ship to Quetta?")).toHaveCount(0, { timeout: 15_000 });
    html = await publicFaq();
    expect(html).not.toContain("E2E Do you ship to Quetta?");
  });

  test("an order placed with a map pin shows the owner a link to the customer's spot", async ({ page, request }) => {
    await cleanOrders();
    const v = await setStock("NA-TE-SAS-M", 20);
    const placed = await placeOrder(request, { items: [{ variantId: v.id, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const id = await orderIdOf(String(placed.body.orderNumber));
    await login(page);
    await page.goto(`/admin/orders/${id}`);
    await expect(page.getByText(/Open the customer’s pin/)).toHaveCount(0); // no pin, no link
    await sql`update orders set delivery_latitude = 31.5204, delivery_longitude = 74.3587 where id = ${id}`;
    await page.reload();
    const link = page.getByRole("link", { name: /Open the customer’s pin in Google Maps/ });
    await expect(link).toHaveAttribute("href", "https://www.google.com/maps?q=31.5204,74.3587");
    await expect(link).toHaveAttribute("rel", /noopener/);
    void variantBySku;
  });
});
