import { expect, test } from "@playwright/test";

/**
 * Runs only against a server that behaves as the training lab (SANDBOX=1) with the practice tables ready in the throwaway database:
 *   SANDBOX=1 SANDBOX_HITS_PER_DAY=80 TRAINING_PASSWORD=<password> PRACTICE_DATABASE_URL=<practice connection string> DATABASE_URL=<the same>
 *   E2E_SANDBOX_URL=http://localhost:3200 E2E_TRAINING_PASSWORD=<password> npx playwright test e2e/ui/sandbox.spec.ts --project=chromium
 * (the normal suite skips it. See scripts/practice-create.ts, practice-migrate.ts and sandbox-setup.ts for making the practice tables.)
 */
const URL = process.env.E2E_SANDBOX_URL;
const PASSWORD = process.env.E2E_TRAINING_PASSWORD ?? "";
test.skip(!URL, "needs a training-lab server (E2E_SANDBOX_URL)");
test.describe.configure({ mode: "serial", timeout: 240_000 });

test("the entrance: a wrong password is refused, the real sign-in does not exist, the right one gets in but the lab waits to be started", async ({ page }) => {
  const request = page.request;
  expect((await request.post(`${URL}/api/admin/sandbox/enter`, { data: { name: "Ayesha", password: "definitely-wrong" } })).status()).toBe(401);
  expect((await request.post(`${URL}/api/admin/sandbox/enter`, { data: { name: "", password: PASSWORD } })).status()).toBe(400);
  // the real admin's sign-in is switched off on the training site
  expect((await request.post(`${URL}/api/admin/login`, { data: { email: "a@b.c", password: "x" } })).status()).toBe(404);
  // signed out: every admin page and API says no, and pages go to the lab entrance
  expect((await request.get(`${URL}/api/admin/messages`)).status()).toBe(401);
  await page.goto(`${URL}/admin/orders`);
  await expect(page).toHaveURL(/\/admin\/training-login/);
  await page.goto(`${URL}/admin/login`);
  await expect(page).toHaveURL(/\/admin\/training-login/);

  await page.getByLabel("Your name").fill("Ayesha");
  await page.getByLabel("Training password").fill(PASSWORD);
  await page.getByRole("button", { name: "Enter the lab" }).click();
  // signed in, but nothing opens until the lab is started
  await expect(page).toHaveURL(/\/admin\/training-start/);
  await expect(page.getByRole("heading", { name: /Welcome, Ayesha/ })).toBeVisible();
  await page.goto(`${URL}/admin/orders`);
  await expect(page).toHaveURL(/\/admin\/training-start/);
});

test("starting the lab: a visible get-ready wait, then the lab opens with its own strip, menu and lessons", async ({ page }) => {
  await page.request.post(`${URL}/api/admin/sandbox/enter`, { data: { name: "Ayesha", password: PASSWORD } });
  await page.goto(`${URL}/admin/training-start`);
  await page.getByRole("button", { name: "Start my lab" }).click();
  await expect(page.getByRole("status")).toContainText("Starting your lab");
  await expect(page).toHaveURL(/\/admin\/training$/, { timeout: 30_000 });

  const bar = page.locator(".a-sandbar");
  await expect(bar).toContainText("TRAINING LAB");
  await expect(bar).toContainText(/clicks left today/);
  await expect(page.getByRole("link", { name: "Guided labs" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Lessons" })).toBeVisible();
  // none of the real-admin-only extras (alerts, real sign-out destination) are offered
  await expect(page.getByText("Alerts")).toHaveCount(0);
});

test("a guided lab: the guide stays over the admin, ticks a step only when it was really done, and Start again puts everything back", async ({ page }) => {
  const request = page.request;
  await request.post(`${URL}/api/admin/sandbox/enter`, { data: { name: "Ayesha", password: PASSWORD } });
  expect((await request.post(`${URL}/api/admin/sandbox/start`)).status()).toBe(200);

  await page.goto(`${URL}/admin/training/labs`);
  await expect(page.getByRole("heading", { name: "Customer ke sawal ka jawab likhein" })).toBeVisible();
  await page.locator(".lab-card", { hasText: "Customer ke sawal" }).getByRole("button", { name: "Lab shuru karein" }).click();
  await expect(page).toHaveURL(/\/admin\/faqs/);
  const guide = page.locator(".lab-guide");
  await expect(guide).toContainText("0 / 2");

  // nothing done yet: checking says so and ticks nothing
  await guide.getByRole("button", { name: "Mera kaam check karein" }).click();
  await expect(guide).toContainText("0 / 2");

  // a question without a real answer ticks only the first step
  expect((await request.post(`${URL}/api/admin/faqs`, { data: { question: "PRACTICE question?", answer: "Yes." } })).status()).toBe(201);
  await guide.getByRole("button", { name: "Mera kaam check karein" }).click();
  await expect(guide).toContainText("1 / 2", { timeout: 15_000 });

  // a full-sentence answer finishes the lab (the guide also looks by itself every few seconds)
  expect((await request.post(`${URL}/api/admin/faqs`, { data: { question: "PRACTICE delivery?", answer: "Yes, we deliver everywhere in Pakistan by TCS." } })).status()).toBe(201);
  await expect(guide).toContainText("Lab mukammal", { timeout: 30_000 });

  // Start again: the new questions are gone and the guide forgets what it had ticked
  await page.getByRole("button", { name: "Start again" }).click();
  await page.getByRole("button", { name: "Yes, start again" }).click();
  await expect(page.locator(".a-toast.good")).toContainText("starting data", { timeout: 30_000 });
  await expect(guide).toContainText("0 / 2", { timeout: 15_000 });
  await page.goto(`${URL}/admin/faqs`);
  await expect(page.getByText("PRACTICE question?")).toHaveCount(0);
  await expect(page.getByText("PRACTICE delivery?")).toHaveCount(0);
});

test("the day's allowance runs out: calls get a plain 429, pages a friendly page, the entrance still works", async ({ page }) => {
  const request = page.request;
  await request.post(`${URL}/api/admin/sandbox/enter`, { data: { name: "Ayesha", password: PASSWORD } });
  await request.post(`${URL}/api/admin/sandbox/start`);
  let blocked = false;
  for (let i = 0; i < 220 && !blocked; i++) {
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
  expect((await page.goto(`${URL}/admin/training-login`))!.status()).toBe(200);
  // starting and checking are never counted, so a trainee can always reset
  expect((await request.post(`${URL}/api/admin/sandbox/start`)).status()).toBe(200);
});
