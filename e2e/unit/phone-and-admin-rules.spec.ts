import { expect, test } from "@playwright/test";
import { DEFAULT_ABOUT_BODY, parseStory } from "../../lib/about-content";
import { customEmailHtml, fillPreset, MESSAGE_PRESETS } from "../../lib/messages";
import { isAnnouncementStyle } from "../../lib/shop-rules";
import { FAST_MINUTES, SLOW_MINUTES, storefrontDelayMessage, storefrontDelayMinutes } from "../../lib/storefront-delay";
import { unsubscribeToken, verifyUnsubscribeToken } from "../../lib/unsubscribe";

test.describe("how long until a change shows on the website", () => {
  test("changes to what shoppers see promise a wait; reading, push and unrelated changes do not", () => {
    expect(storefrontDelayMinutes("/api/admin/products/123", "PATCH")).toBe(FAST_MINUTES);
    expect(storefrontDelayMinutes("/api/admin/delivery-zones", "POST")).toBe(FAST_MINUTES);
    expect(storefrontDelayMinutes("/api/admin/campaign", "POST")).toBe(FAST_MINUTES);
    expect(storefrontDelayMinutes("/api/admin/settings", "PATCH")).toBe(SLOW_MINUTES);
    expect(storefrontDelayMinutes("/api/admin/faqs/9", "DELETE")).toBe(SLOW_MINUTES);
    expect(storefrontDelayMinutes("/api/admin/products", "GET")).toBeNull();
    expect(storefrontDelayMinutes("/api/admin/orders/5", "PATCH")).toBeNull();
    expect(storefrontDelayMinutes("/api/admin/push", "POST")).toBeNull();
    expect(storefrontDelayMinutes("/api/admin/messages/push", "POST")).toBeNull();
  });

  test("the promise names the minutes and the clock time, in Pakistan time", () => {
    const text = storefrontDelayMessage(3, new Date("2026-10-08T10:00:00Z")); // 15:00 in Karachi
    expect(text).toContain("about 3 minutes");
    expect(text).toMatch(/3:03\s?pm/i);
  });
});

test.describe("Our story text", () => {
  test("paragraphs, the quote and links are read; nothing typed can become markup", () => {
    const blocks = parseStory(DEFAULT_ABOUT_BODY);
    expect(blocks.filter((block) => block.kind === "quote")).toHaveLength(1);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    const last = blocks[blocks.length - 1];
    expect(last.parts.filter((part) => part.kind === "link").map((part) => (part.kind === "link" ? part.href : ""))).toEqual(["/policies/returns", "/contact"]);

    const evil = parseStory("Hello <script>alert(1)</script> [bad](javascript:alert(1)) and [fine](https://example.com) and [odd](//evil.example)");
    const parts = evil[0].parts;
    expect(parts.every((part) => part.kind === "text" || /^https:\/\/example\.com$/.test(part.href))).toBe(true);
    expect(JSON.stringify(parts)).not.toContain("javascript:alert");
    expect(parseStory("")).toEqual([]);
  });
});

test.describe("messages", () => {
  test("a reply starts from a ready-made text with the customer's name and order filled in", () => {
    expect(MESSAGE_PRESETS.length).toBeGreaterThanOrEqual(4);
    const preset = MESSAGE_PRESETS[0];
    const text = fillPreset(preset.body, { name: "Ali", order: "NA-1001" });
    expect(text).toContain("Ali");
    expect(text).toContain("NA-1001");
    expect(text).not.toContain("{");
    expect(fillPreset("Hi {name}", {})).toBe("Hi there");
    expect(fillPreset("About your order {order}. Thanks", {})).toBe("About your order. Thanks"); // no order number: no gap
  });

  test("the email escapes everything the owner types and only accepts https buttons", () => {
    const html = customEmailHtml({ subject: "<b>Sale</b>", body: "Line one\nline two\n\nSecond <img src=x onerror=alert(1)>", buttonLabel: "Shop", buttonUrl: "https://nureasmir.com/shop" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Sale</b>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("line two");
    expect(html).toContain('href="https://nureasmir.com/shop"');
    expect(customEmailHtml({ subject: "s", body: "b", buttonLabel: "x", buttonUrl: "javascript:alert(1)" })).not.toContain("javascript:");
    expect(customEmailHtml({ subject: "s", body: "b", unsubscribeUrl: "https://nureasmir.com/unsubscribe?e=a" })).toContain("Unsubscribe");
    expect(customEmailHtml({ subject: "s", body: "b" })).not.toContain("Unsubscribe");
  });

  test("an unsubscribe link only works for the address it was made for", async () => {
    process.env.CRON_SECRET = "test-secret-for-unsubscribe";
    const token = await unsubscribeToken("Buyer@Example.com");
    expect(token).toHaveLength(32);
    expect(await verifyUnsubscribeToken("buyer@example.com", token)).toBe(true); // capital letters do not matter
    expect(await verifyUnsubscribeToken("other@example.com", token)).toBe(false);
    expect(await verifyUnsubscribeToken("buyer@example.com", token.replace(/.$/, "0"))).toBe(token.endsWith("0"));
    expect(await verifyUnsubscribeToken("buyer@example.com", "")).toBe(false);
  });

  test("the top bar knows its three movements", () => {
    for (const style of ["rotate", "scroll-left", "scroll-right"]) expect(isAnnouncementStyle(style)).toBe(true);
    for (const style of ["fast", "", null, undefined]) expect(isAnnouncementStyle(style)).toBe(false);
  });
});
