import { expect, test } from "@playwright/test";
import { BASE } from "../support/helpers";

/** Covers host-provided country detection used to initialize the currency selector. */
test.describe("visitor country (for the currency selector)", () => {
  /** Verifies normalized country values from Vercel and the Cloudflare fallback. */
  test("uses the country the host reports: Vercel's header first, Cloudflare's as a fallback", async ({ request }) => {
    const vercel = await request.get(`${BASE}/api/geo/country`, { headers: { "x-vercel-ip-country": "PK" } });
    expect((await vercel.json()).country).toBe("PK");
    const cloudflare = await request.get(`${BASE}/api/geo/country`, { headers: { "cf-ipcountry": "ae" } });
    expect((await cloudflare.json()).country).toBe("AE");
  });
  /** Verifies invalid country values return null, even when a valid Cloudflare fallback is present. */
  test("an unknown or malformed value gives no country", async ({ request }) => {
    for (const value of ["XX", "T1", "", "PAK", "1A"]) {
      const res = await request.get(`${BASE}/api/geo/country`, { headers: { "x-vercel-ip-country": value } });
      expect((await res.json()).country, value).toBeNull();
    }
    const mixed = await request.get(`${BASE}/api/geo/country`, {
      headers: { "x-vercel-ip-country": "XX", "cf-ipcountry": "AE" },
    });
    expect((await mixed.json()).country).toBeNull();
  });
});
