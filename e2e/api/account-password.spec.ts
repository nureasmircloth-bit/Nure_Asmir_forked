import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { BASE, freshIp, sql } from "../support/helpers";

/**
 * The signed-in owner changes their own password. The current one is asked for again, a short or repeated password is refused, wrong guesses are
 * throttled, and every other session of the account is signed out. The original password hash is put back afterwards.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL!;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD!;
const NEW_PASSWORD = "A-brand-new E2E password 2026";

test.describe("changing my own password", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let originalHash = "";

  async function signIn(password: string, ip = freshIp()): Promise<{ api: APIRequestContext; status: number }> {
    const api = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": ip } });
    const response = await api.post("/api/admin/login", { data: { email: EMAIL, password } });
    return { api, status: response.status() };
  }

  test.beforeAll(async () => {
    const [row] = (await sql`select password_hash from admin_owners where lower(email) = lower(${EMAIL})`) as Array<{ password_hash: string }>;
    originalHash = row.password_hash;
    await sql`delete from login_attempts where lower(email) = lower(${EMAIL}) or email like ${"password:%"}`;
  });
  test.afterAll(async () => {
    await sql`update admin_owners set password_hash = ${originalHash} where lower(email) = lower(${EMAIL})`;
    await sql`delete from login_attempts where lower(email) = lower(${EMAIL}) or email like ${"password:%"}`;
  });

  test("needs a signed-in account, the right current password and a long enough new one", async () => {
    const anonymous = await playwrightRequest.newContext({ baseURL: BASE });
    expect((await anonymous.post("/api/admin/account/password", { data: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } })).status()).toBe(401);

    const { api, status } = await signIn(PASSWORD);
    expect(status).toBe(200);
    const change = (currentPassword: string, newPassword: string) => api.post("/api/admin/account/password", { data: { currentPassword, newPassword } });
    expect((await change("not-my-password", NEW_PASSWORD)).status()).toBe(400);
    expect((await change(PASSWORD, "short")).status()).toBe(400);
    expect((await change(PASSWORD, PASSWORD)).status()).toBe(400);
    expect((await change(PASSWORD, `${EMAIL.split("@")[0]}-and-more-words`)).status()).toBe(400);
    // nothing changed: the old password still signs in
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  test("a change takes effect at once, signs out the other devices and keeps this one", async () => {
    const laptop = await signIn(PASSWORD);
    const phone = await signIn(PASSWORD);
    expect((await phone.api.get("/api/admin/stock/export")).status()).toBe(200);

    const done = await laptop.api.post("/api/admin/account/password", { data: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
    expect(done.status()).toBe(200);

    expect((await laptop.api.get("/api/admin/stock/export")).status(), "the device that changed it stays signed in").toBe(200);
    expect((await phone.api.get("/api/admin/stock/export")).status(), "the other device is signed out").toBe(401);
    expect((await signIn(PASSWORD)).status, "the old password no longer works").toBe(401);
    expect((await signIn(NEW_PASSWORD)).status, "the new one does").toBe(200);
  });

  test("guessing the current password is throttled", async () => {
    const { api } = await signIn(NEW_PASSWORD);
    const ip = freshIp();
    let last = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      last = (await api.post("/api/admin/account/password", { data: { currentPassword: `wrong-guess-${attempt}`, newPassword: NEW_PASSWORD + "!" }, headers: { "x-forwarded-for": ip } })).status();
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
