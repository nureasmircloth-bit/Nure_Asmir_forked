import { expect, test } from "@playwright/test";
import { dailyHitLimit, hitCountsAgainstLimit, hitState, isSandboxEnv, roomMessage, SANDBOX_LIMITS } from "../../lib/sandbox-rules";

const headers = (values: Record<string, string> = {}) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

test.describe("the practice shop", () => {
  test("only the practice Worker is a practice shop", () => {
    expect(isSandboxEnv({ SANDBOX: "1" })).toBe(true);
    expect(isSandboxEnv({ SANDBOX: "0" })).toBe(false);
    expect(isSandboxEnv({})).toBe(false);
  });

  test("a click is counted for admin pages and admin calls, but not for prefetching, sign-in, pictures or the Start again button", () => {
    expect(hitCountsAgainstLimit("/admin", "GET", headers())).toBe(true);
    expect(hitCountsAgainstLimit("/admin/orders", "GET", headers())).toBe(true);
    expect(hitCountsAgainstLimit("/api/admin/products", "POST", headers())).toBe(true);
    expect(hitCountsAgainstLimit("/api/admin/settings", "PATCH", headers())).toBe(true);
    expect(hitCountsAgainstLimit("/admin/orders", "GET", headers({ "next-router-prefetch": "1" }))).toBe(false);
    expect(hitCountsAgainstLimit("/admin/login", "GET", headers())).toBe(false);
    expect(hitCountsAgainstLimit("/api/admin/login", "POST", headers())).toBe(false);
    expect(hitCountsAgainstLimit("/api/admin/logout", "POST", headers())).toBe(false);
    expect(hitCountsAgainstLimit("/api/admin/sandbox/reset", "POST", headers())).toBe(false);
    expect(hitCountsAgainstLimit("/_next/static/chunks/a.js", "GET", headers())).toBe(false);
    expect(hitCountsAgainstLimit("/cdn/pictures/a.webp", "GET", headers())).toBe(false);
    expect(hitCountsAgainstLimit("/shop", "GET", headers())).toBe(false);
  });

  test("the daily allowance counts down, then blocks; the number can be changed with a setting", () => {
    expect(hitState(0)).toMatchObject({ used: 0, left: 1500, blocked: false });
    expect(hitState(1499)).toMatchObject({ left: 1, blocked: false });
    expect(hitState(1500)).toMatchObject({ left: 0, blocked: false }); // the last click is still allowed
    expect(hitState(1501)).toMatchObject({ left: 0, blocked: true });
    expect(dailyHitLimit({})).toBe(SANDBOX_LIMITS.hitsPerDay);
    expect(dailyHitLimit({ SANDBOX_HITS_PER_DAY: "200" })).toBe(200);
    expect(dailyHitLimit({ SANDBOX_HITS_PER_DAY: "junk" })).toBe(SANDBOX_LIMITS.hitsPerDay);
    expect(dailyHitLimit({ SANDBOX_HITS_PER_DAY: "-5" })).toBe(SANDBOX_LIMITS.hitsPerDay);
  });

  test("each kind of thing has a limit and a plain explanation when it is full", () => {
    expect(roomMessage("products", 24)).toBeNull();
    expect(roomMessage("products", 25)).toMatch(/up to 25 products/);
    expect(roomMessage("flashSales", 5)).toMatch(/flash sales/);
    expect(roomMessage("coupons", 3)).toBeNull();
  });
});
