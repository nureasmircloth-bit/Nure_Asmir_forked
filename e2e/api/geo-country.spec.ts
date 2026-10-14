import { expect, test } from "@playwright/test";
import { BASE } from "../support/helpers";

test.describe("visitor country (for the currency selector)", () => {
  test("uses the country the host reports: Vercel's header first, Cloudflare's as a fallback", async ({ request }) => {
    const vercel = await request.get(`${BASE}/api/geo/country`, { headers: { "x-vercel-ip-country": "PK" } });
    expect((await vercel.json()).country).toBe("PK");
    const cloudflare = await request.get(`${BASE}/api/geo/country`, { headers: { "cf-ipcountry": "ae" } });
    expect((await cloudflare.json()).country).toBe("AE");
  });
  test("an unknown or malformed value gives no country", async ({ request }) => {
    for (const value of ["XX", "T1", "", "PAK", "1A"]) {
      const res = await request.get(`${BASE}/api/geo/country`, { headers: { "x-vercel-ip-country": value } });
      expect((await res.json()).country, value).toBeNull();
    }
  });
});
