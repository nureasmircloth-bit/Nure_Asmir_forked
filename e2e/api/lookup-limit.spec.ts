import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * Guessing protection on the public lookups (order number + phone, coupon codes): after 25 wrong guesses from one visitor address the
 * lookup pauses with a 429, while other visitors are not affected. Each test uses its own made-up address (Cloudflare's CF-Connecting-IP
 * is what the app trusts), so no earlier run or other test can interfere.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
// Attempts are remembered for 15 minutes, so every test uses a brand-new made-up address (from the IPv6 documentation range, 64 random bits):
// nothing left over from an earlier run can ever count against it.
const uniqueIp = () => {
  const bits = randomUUID().replace(/-/g, "");
  return `2001:db8:${bits.slice(0, 4)}:${bits.slice(4, 8)}:${bits.slice(8, 12)}::${bits.slice(12, 16)}`;
};

test.describe("lookup guessing limit", () => {
  test("order lookup: wrong guesses are answered 404 up to the limit, then 429; another visitor is not affected", async ({ request }) => {
    const ip = uniqueIp();
    const other = uniqueIp();
    const guess = (address: string, number: string) =>
      request.post(`${BASE}/api/orders/track`, { headers: { "cf-connecting-ip": address }, data: { orderNumber: number, phone: "03001234567" } });
    for (let i = 0; i < 25; i++) expect((await guess(ip, `NA-NOPE${i}`)).status(), `guess ${i + 1}`).toBe(404);
    const blocked = await guess(ip, "NA-NOPE-AGAIN");
    expect(blocked.status()).toBe(429);
    expect((await blocked.json()).error).toMatch(/too many/i);
    // the same limit covers cancel and refund lookups from that visitor
    const cancel = await request.post(`${BASE}/api/orders/cancel`, { headers: { "cf-connecting-ip": ip }, data: { orderNumber: "NA-X1", phone: "03001234567", reason: "changed_mind" } });
    expect(cancel.status()).toBe(429);
    // someone else, from another address, still gets the normal answer
    expect((await guess(other, "NA-NOPE-OTHER")).status()).toBe(404);
  });

  test("coupon check: wrong codes are answered 400 up to the limit, then 429", async ({ request }) => {
    const ip = uniqueIp();
    const check = (code: string) => request.post(`${BASE}/api/checkout/validate-coupon`, { headers: { "cf-connecting-ip": ip }, data: { code, subtotal: 5000, deliveryCharge: 250 } });
    for (let i = 0; i < 25; i++) expect((await check(`NOSUCHCODE${i}`)).status(), `guess ${i + 1}`).toBe(400);
    expect((await check("NOSUCHCODE-AGAIN")).status()).toBe(429);
  });
});
