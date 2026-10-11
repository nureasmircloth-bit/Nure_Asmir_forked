import { expect, test } from "@playwright/test";

/** The PostHog sender must stay silent until the visitor allows analytics, send no personal details, and forget the visitor on "no". */
process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_unit_test_key";

type Sent = { url: string; body: Record<string, unknown> };
const sent: Sent[] = [];
const storage = new Map<string, string>();

Object.assign(globalThis, {
  window: {
    location: { href: "https://nureasmir.com/products/olive", pathname: "/products/olive", host: "nureasmir.com" },
    screen: { width: 375, height: 812 },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  },
  fetch: async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response("");
  },
});

test.describe("analytics (PostHog sender)", () => {
  test.beforeEach(() => {
    sent.length = 0;
    storage.clear();
  });

  test("sends nothing before the visitor allows analytics", async () => {
    const { track, setAnalyticsConsent } = await import("../../lib/analytics");
    setAnalyticsConsent(false);
    track("added_to_bag", { product: "olive" });
    expect(sent).toHaveLength(0);
  });

  test("after allowing, sends the event to the EU address with a random id and page details but no personal data", async () => {
    const { track, setAnalyticsConsent, analyticsConfigured } = await import("../../lib/analytics");
    expect(analyticsConfigured()).toBe(true);
    setAnalyticsConsent(true);
    track("order_placed", { value: 12500, currency: "PKR" });
    track("added_to_bag", { product: "olive" });
    expect(sent).toHaveLength(2);
    expect(sent[0].url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(sent[0].body).toMatchObject({ api_key: "phc_unit_test_key", event: "order_placed" });
    const properties = sent[0].body.properties as Record<string, unknown>;
    expect(properties).toMatchObject({ value: 12500, currency: "PKR", $pathname: "/products/olive", $host: "nureasmir.com" });
    // the same browser keeps the same random id, and it looks like a UUID, not a name or phone number
    expect(sent[0].body.distinct_id).toBe(sent[1].body.distinct_id);
    expect(String(sent[0].body.distinct_id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("saying no afterwards forgets the id and stops sending", async () => {
    const { track, setAnalyticsConsent } = await import("../../lib/analytics");
    setAnalyticsConsent(true);
    track("$pageview");
    expect(storage.get("na-ph-id")).toBeTruthy();
    setAnalyticsConsent(false);
    expect(storage.get("na-ph-id")).toBeUndefined();
    track("$pageview");
    expect(sent).toHaveLength(1);
  });
});
