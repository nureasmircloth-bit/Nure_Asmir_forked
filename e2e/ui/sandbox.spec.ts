import { expect, test } from "@playwright/test";

/**
 * Runs only against a server that practises all the time (SANDBOX=1) with the practice tables ready in the throwaway database:
 *   SANDBOX=1 SANDBOX_HITS_PER_DAY=60 PRACTICE_DATABASE_URL=<practice connection string> E2E_PRACTICE_EMAIL=… E2E_PRACTICE_PASSWORD=…  *   E2E_SANDBOX_URL=http://localhost:3100 npx playwright test e2e/ui/sandbox.spec.ts --project=chromium
 * (the normal suite skips it. See scripts/practice-create.ts, practice-migrate.ts and sandbox-setup.ts for making the practice tables.)
 */
const URL = process.env.E2E_SANDBOX_URL;
test.skip(!URL, "needs a practice-shop server (E2E_SANDBOX_URL)");
test.describe.configure({ mode: "serial", timeout: 240_000 });

test("practice shop: banner, the allowance running out, sign-in still possible, and Start again putting everything back", async ({ page }) => {
  const request = page.request; // shares the sign-in with the page
  const login = await request.post(`${URL}/api/admin/login`, { data: { email: process.env.E2E_PRACTICE_EMAIL, password: process.env.E2E_PRACTICE_PASSWORD } });
  expect(login.status()).toBe(200);

  await page.goto(`${URL}/admin`);
  const bar = page.locator(".a-sandbar");
  await expect(bar).toContainText("PRACTICE SHOP");
  await expect(bar).toContainText(/clicks left today/);

  // something to undo later
  const made = await request.post(`${URL}/api/admin/faqs`, { data: { question: "PRACTICE question?", answer: "A practice answer." } });
  expect(made.status()).toBe(201);
  await page.goto(`${URL}/admin/faqs`);
  await expect(page.getByText("PRACTICE question?")).toBeVisible();

  // Start again puts the starting data back
  await page.getByRole("button", { name: "Start again" }).click();
  await page.getByRole("button", { name: "Yes, start again" }).click();
  await expect(page.locator(".a-toast.good")).toContainText("starting practice data", { timeout: 30_000 });
  await page.goto(`${URL}/admin/faqs`);
  await expect(page.getByText("PRACTICE question?")).toHaveCount(0);

  // spend the allowance: calls are answered with a plain 429, pages with a friendly page, sign-in still works
  let blocked = false;
  for (let i = 0; i < 90 && !blocked; i++) {
    const response = await request.get(`${URL}/api/admin/messages`);
    if (response.status() === 429) {
      blocked = true; // (a flag, not a count: the very first call may already be blocked)
      expect((await response.json()).error).toMatch(/practice/i);
    }
  }
  expect(blocked, "the allowance ran out").toBe(true);
  const pageResponse = await page.goto(`${URL}/admin/orders`);
  expect(pageResponse!.status()).toBe(429);
  await expect(page.locator("body")).toContainText("enough practice for today");
  expect((await page.goto(`${URL}/admin/login`))!.status()).toBe(200);
});
