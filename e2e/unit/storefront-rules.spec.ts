import { expect, test } from "@playwright/test";
import { countFilters, EMPTY_FILTERS, filtersToParams, hasFilters, parseFilters, parseList, sortSizes } from "../../lib/catalog-filters";
import { currencyForCountry, flagSrc, CURRENCIES, FLAG_OF } from "../../lib/currency";
import { fillFaqTokens } from "../../lib/faqs";
import { insidePakistan, parseReverse, parseSuggestions, provinceFromState, validTile } from "../../lib/geo";
import { allowedPaymentMethods, buildAnnouncements, computeDeliveryCharge, freeDeliveryHint, isPaymentAllowed, parseLines } from "../../lib/shop-rules";

test.describe("top bar text", () => {
  test("automatic mode is built from the real rules and then the owner's extra lines", () => {
    const lines = buildAnnouncements({ mode: "auto", lines: "New arrivals every week", freeDeliveryAbove: 10000, bankDepositEnabled: false });
    expect(lines).toEqual(["Cash on delivery available all over Pakistan", "Free delivery on orders above Rs. 10,000", "New arrivals every week"]);
  });
  test("free delivery is never mentioned when the rule is off, and bank transfer only when it is on", () => {
    expect(buildAnnouncements({ mode: "auto", lines: "", freeDeliveryAbove: 0, bankDepositEnabled: false })).toEqual(["Cash on delivery available all over Pakistan"]);
    expect(buildAnnouncements({ mode: "auto", lines: "", freeDeliveryAbove: 5000, bankDepositEnabled: true }).join("|")).toContain("bank transfer");
  });
  test("custom mode shows only the owner's lines (and falls back to the rules if there are none); off hides the bar", () => {
    expect(buildAnnouncements({ mode: "custom", lines: "Eid sale is live\nFree gift on Friday", freeDeliveryAbove: 10000, bankDepositEnabled: false })).toEqual(["Eid sale is live", "Free gift on Friday"]);
    expect(buildAnnouncements({ mode: "custom", lines: "   \n", freeDeliveryAbove: 10000, bankDepositEnabled: false }).length).toBeGreaterThan(0);
    expect(buildAnnouncements({ mode: "off", lines: "x", freeDeliveryAbove: 10000, bankDepositEnabled: true })).toEqual([]);
  });
  test("owner lines are trimmed, cut to 140 characters, limited to six and never empty", () => {
    const many = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join("\n");
    expect(parseLines(many)).toHaveLength(6);
    expect(parseLines("  hello   world  \r\n\r\n")).toEqual(["hello world"]);
    expect(parseLines("x".repeat(500))[0]).toHaveLength(140);
    expect(parseLines(null)).toEqual([]);
  });
});

test.describe("payment methods", () => {
  test("cash on delivery is always offered; bank transfer only when switched on", () => {
    expect(allowedPaymentMethods(false)).toEqual(["cod"]);
    expect(allowedPaymentMethods(true)).toEqual(["cod", "bank_deposit"]);
    expect(isPaymentAllowed("bank_deposit", false)).toBe(false);
    expect(isPaymentAllowed("bank_deposit", true)).toBe(true);
    expect(isPaymentAllowed("cod", false)).toBe(true);
    for (const junk of ["card", "", null, undefined, 5, "COD"]) expect(isPaymentAllowed(junk, true), String(junk)).toBe(false);
  });
});

test.describe("delivery charge", () => {
  const base = { mode: "zones" as const, subtotal: 5000, freeAbove: 10000, zoneCharge: 300, flatCharge: 250 };
  test("zones: the area's price below the free amount; free at and above it", () => {
    expect(computeDeliveryCharge(base)).toBe(300);
    expect(computeDeliveryCharge({ ...base, subtotal: 9999 })).toBe(300);
    expect(computeDeliveryCharge({ ...base, subtotal: 10000 })).toBe(0);
    expect(computeDeliveryCharge({ ...base, subtotal: 25000 })).toBe(0);
  });
  test("a free-delivery amount of 0 means 'no free delivery', not 'everything is free'", () => {
    expect(computeDeliveryCharge({ ...base, freeAbove: 0, subtotal: 1 })).toBe(300);
    expect(computeDeliveryCharge({ ...base, freeAbove: 0, subtotal: 900000 })).toBe(300);
  });
  test("flat: one price everywhere, still free above the amount", () => {
    expect(computeDeliveryCharge({ ...base, mode: "flat" })).toBe(250);
    expect(computeDeliveryCharge({ ...base, mode: "flat", zoneCharge: 999 })).toBe(250);
    expect(computeDeliveryCharge({ ...base, mode: "flat", subtotal: 10001 })).toBe(0);
  });
  test("tcs: the tariff when known, otherwise the area price so an order is never blocked", () => {
    expect(computeDeliveryCharge({ ...base, mode: "tcs", tcsCharge: 420 })).toBe(420);
    expect(computeDeliveryCharge({ ...base, mode: "tcs", tcsCharge: null })).toBe(300);
    expect(computeDeliveryCharge({ ...base, mode: "tcs", tcsCharge: Number.NaN })).toBe(300);
    expect(computeDeliveryCharge({ ...base, mode: "tcs", tcsCharge: 420, subtotal: 12000 })).toBe(0);
  });
  test("never negative, never fractional, never NaN", () => {
    expect(computeDeliveryCharge({ ...base, zoneCharge: -50 })).toBe(0);
    expect(computeDeliveryCharge({ ...base, zoneCharge: 299.6 })).toBe(300);
    expect(computeDeliveryCharge({ ...base, zoneCharge: Number.NaN })).toBe(0);
  });
  test("the 'add Rs. X more' hint disappears once delivery is free or there is no rule", () => {
    expect(freeDeliveryHint(7500, 10000)).toBe("Add Rs. 2,500 more to get free delivery");
    expect(freeDeliveryHint(10000, 10000)).toBeNull();
    expect(freeDeliveryHint(500, 0)).toBeNull();
  });
});

test.describe("shop filters", () => {
  test("read from a web address, trimmed and de-duplicated", () => {
    const f = parseFilters(new URLSearchParams("min=2000&max=8000&sizes=M, l ,M,,XL&colors=Olive,olive,Navy&stock=1"));
    expect(f).toEqual({ min: 2000, max: 8000, sizes: ["M", "l", "XL"], colors: ["Olive", "Navy"], inStock: true });
  });
  test("a price range typed the wrong way round is put right; junk prices are ignored", () => {
    expect(parseFilters(new URLSearchParams("min=9000&max=1000"))).toMatchObject({ min: 1000, max: 9000 });
    const junk = parseFilters(new URLSearchParams("min=abc&max=-5&stock=yes"));
    expect(junk.min).toBeUndefined();
    expect(junk.max).toBeUndefined();
    expect(junk.inStock).toBe(false);
    expect(parseFilters(new URLSearchParams("max=99999999999")).max).toBe(1_000_000);
  });
  test("lists are capped at 12 values and 30 characters each; control characters are removed", () => {
    expect(parseList(Array.from({ length: 30 }, (_, i) => `S${i}`).join(","))).toHaveLength(12);
    expect(parseList("x".repeat(100))[0]).toHaveLength(30);
    expect(parseList("a\u0000b")).toEqual(["a b"]);
    expect(parseList(null)).toEqual([]);
  });
  test("round-trips through the web address, counts how many filters are on, and sorts sizes the way shoppers expect", () => {
    const f = parseFilters(new URLSearchParams("min=1000&sizes=M&colors=Olive&stock=1"));
    expect(parseFilters(filtersToParams(f))).toEqual(f);
    expect(countFilters(f)).toBe(4);
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe("");
    expect(sortSizes(["XL", "S", "32", "M", "30", "XXL", "One size", "L"])).toEqual(["S", "M", "L", "XL", "XXL", "30", "32", "One size"]);
  });
});

test.describe("locations", () => {
  test("provinces are recognised from the map service's wording, in every spelling it uses", () => {
    expect(provinceFromState("Punjab")).toBe("Punjab");
    expect(provinceFromState("Sindh")).toBe("Sindh");
    expect(provinceFromState("Khyber Pakhtunkhwa")).toBe("Khyber Pakhtunkhwa");
    expect(provinceFromState("Balochistan")).toBe("Balochistan");
    expect(provinceFromState("Gilgit-Baltistan")).toBe("Gilgit-Baltistan");
    expect(provinceFromState("Azad Kashmir")).toBe("Azad Jammu and Kashmir");
    expect(provinceFromState("Punjab", "Islamabad")).toBe("Islamabad Capital Territory");
    expect(provinceFromState("", "")).toBeNull();
    expect(provinceFromState("Texas")).toBeNull();
  });
  test("only points inside Pakistan are accepted", () => {
    expect(insidePakistan(31.52, 74.35)).toBe(true); // Lahore
    expect(insidePakistan(24.86, 67.0)).toBe(true); // Karachi
    expect(insidePakistan(51.5, -0.12)).toBe(false); // London
    expect(insidePakistan(0, 0)).toBe(false);
    expect(insidePakistan(Number.NaN, 74)).toBe(false);
  });
  test("a map tile must be a real tile address", () => {
    expect(validTile(16, 36000, 20000)).toBe(true);
    expect(validTile(4, 1, 1)).toBe(false); // too far out
    expect(validTile(19, 1, 1)).toBe(false); // too far in
    expect(validTile(10, 1024, 5)).toBe(false); // x beyond the world
    expect(validTile(10, -1, 5)).toBe(false);
    expect(validTile(10.5, 1, 1)).toBe(false);
    expect(validTile(Number.NaN, 1, 1)).toBe(false);
  });
  test("a reverse-geocode answer becomes an address, city and province – and nonsense becomes null", () => {
    const result = parseReverse({ features: [{ properties: { formatted: "Park Lane Tower, Tufail Road, Lahore, Punjab, Pakistan", name: "Park Lane Tower", street: "Tufail Road", suburb: "Cantt", city: "Lahore", state: "Punjab" } }] }, 31.5, 74.3);
    expect(result).toMatchObject({ city: "Lahore", province: "Punjab", lat: 31.5, lon: 74.3 });
    expect(result?.address).toContain("Park Lane Tower");
    expect(parseReverse({ features: [] }, 1, 1)).toBeNull();
    expect(parseReverse(null, 1, 1)).toBeNull();
    expect(parseReverse({ features: [{ properties: {} }] }, 1, 1)).toBeNull();
  });
  test("address suggestions carry the province too", () => {
    const [first] = parseSuggestions({ features: [{ properties: { formatted: "DHA Phase 5, Karachi, Sindh", lat: 24.8, lon: 67.0, city: "Karachi", state: "Sindh" } }] });
    expect(first.province).toBe("Sindh");
  });
});

test.describe("currency", () => {
  test("starts on the visitor's own currency: Pakistan stays PKR, known countries get theirs, others get dollars", () => {
    expect(currencyForCountry("PK")).toBe("PKR");
    expect(currencyForCountry("pk")).toBe("PKR");
    expect(currencyForCountry("AE")).toBe("AED");
    expect(currencyForCountry("SA")).toBe("SAR");
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("CA")).toBe("CAD");
    expect(currencyForCountry("AU")).toBe("AUD");
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry("FR")).toBe("EUR");
    expect(currencyForCountry("IN")).toBe("USD");
    for (const junk of [null, undefined, "", "X", "XXX", "12"]) expect(currencyForCountry(junk), String(junk)).toBe("PKR");
  });
  test("every currency has a flag", () => {
    for (const { code } of CURRENCIES) {
      expect(FLAG_OF[code]).toMatch(/^[a-z]{2}$/);
      expect(flagSrc(code)).toBe(`/flags/${FLAG_OF[code]}.svg`);
    }
  });
});

test.describe("FAQ wording", () => {
  test("placeholders are filled from the live settings, including with extra spaces, and plain text is untouched", () => {
    const values = { codHours: 12, freeAbove: 10000, refundDays: 7 };
    expect(fillFaqTokens("Hold {{codHours}} hours. Free above Rs. {{ freeAbove }}. Refund in {{refundDays}} days.", values)).toBe("Hold 12 hours. Free above Rs. 10,000. Refund in 7 days.");
    expect(fillFaqTokens("Nothing to fill", values)).toBe("Nothing to fill");
    expect(fillFaqTokens("{{codHours}}{{codHours}}", values)).toBe("1212");
    expect(fillFaqTokens("{{unknown}}", values)).toBe("{{unknown}}");
  });
});

import { matchZone } from "../../lib/geo";
test.describe("which delivery area a place belongs to", () => {
  const zones = [
    { id: "khi", cities: ["Karachi"], provinces: ["Sindh"] },
    { id: "lhr", cities: ["Lahore", "Islamabad", "Rawalpindi"], provinces: ["Punjab"] },
    { id: "rest", cities: [], provinces: ["Punjab", "Sindh", "KPK", "Balochistan", "Gilgit-Baltistan", "Azad Kashmir"] },
  ];
  test("a named city wins, in any capital letters", () => {
    expect(matchZone(zones, "Lahore", "Punjab")?.id).toBe("lhr");
    expect(matchZone(zones, "  karachi ", "Sindh")?.id).toBe("khi");
    expect(matchZone(zones, "ISLAMABAD", null)?.id).toBe("lhr");
  });
  test("other cities fall back to the catch-all area of their province – not to a city area that merely shares the province", () => {
    expect(matchZone(zones, "Multan", "Punjab")?.id).toBe("rest");
    expect(matchZone(zones, "Hyderabad", "Sindh")?.id).toBe("rest");
  });
  test("province nicknames are understood", () => {
    expect(matchZone(zones, "Peshawar", "Khyber Pakhtunkhwa")?.id).toBe("rest");
    expect(matchZone(zones, "Muzaffarabad", "Azad Jammu and Kashmir")?.id).toBe("rest");
  });
  test("a place that fits nothing gets no area (the shopper chooses), and bad input is safe", () => {
    expect(matchZone(zones, "Springfield", "Texas")).toBeNull();
    expect(matchZone(zones, "", "")).toBeNull();
    expect(matchZone(zones, null, undefined)).toBeNull();
    expect(matchZone([], "Lahore", "Punjab")).toBeNull();
  });
});
