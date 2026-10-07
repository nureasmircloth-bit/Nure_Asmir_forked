import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { applySales, discountedPrice, type ActiveSale } from "../../lib/sales";
import { formatPrice } from "../../lib/currency";
import { isDeadTokenResponse, sendPush } from "../../lib/push/fcm";
import { newObjectKey } from "../../lib/storage";
import { cdnSrcForWidth, cdnSrcSet } from "../../lib/media-url";
import { escapeHtml } from "../../lib/email/escape";

const sale = (over: Partial<ActiveSale> = {}): ActiveSale => ({
  id: "s1",
  name: "Eid",
  type: "percent",
  value: 20,
  startsAt: new Date(Date.now() - 1000),
  endsAt: new Date(Date.now() + 3600_000),
  appliesToAll: false,
  productIds: new Set(["p1"]),
  ...over,
});

test.describe("flash-sale pricing", () => {
  test("percent and fixed discounts round sensibly and never go below Rs. 1", () => {
    expect(discountedPrice(12500, "percent", 20)).toBe(10000);
    expect(discountedPrice(999, "percent", 33)).toBe(669);
    expect(discountedPrice(500, "fixed", 100)).toBe(400);
    expect(discountedPrice(500, "fixed", 9999)).toBe(1);
    expect(discountedPrice(500, "percent", 0)).toBe(500);
    expect(discountedPrice(500, "percent", 150)).toBe(1);
  });

  test("only products in the sale are discounted, 'all' discounts everything, best price wins", () => {
    expect(applySales(1000, "p1", [sale()])?.price).toBe(800);
    expect(applySales(1000, "p2", [sale()])).toBeNull();
    expect(applySales(1000, "anything", [sale({ appliesToAll: true, productIds: new Set() })])?.price).toBe(800);
    const best = applySales(1000, "p1", [sale({ value: 10 }), sale({ id: "s2", value: 40 })]);
    expect(best?.price).toBe(600);
    expect(best?.originalPrice).toBe(1000);
  });
});

test.describe("currency display", () => {
  test("falls back to PKR until rates exist and converts when they do", () => {
    expect(formatPrice(12500, "USD", null)).toBe("Rs. 12,500");
    expect(formatPrice(12500, "PKR", { PKR: 1 })).toBe("Rs. 12,500");
    expect(formatPrice(12500, "USD", { USD: 0.0036 })).toBe("$45.00");
  });
});

test.describe("media URLs", () => {
  test("picks the smallest variant that covers the requested width", () => {
    const src = "/cdn/products/abc.jpg?vw=320.640.960";
    expect(cdnSrcForWidth(src, 300)).toBe("/cdn/products/abc-w320.webp");
    expect(cdnSrcForWidth(src, 641)).toBe("/cdn/products/abc-w640.webp"); // 640 is within 20% of 641
    expect(cdnSrcForWidth(src, 900)).toBe("/cdn/products/abc-w960.webp"); // 640 would be more than 20% too small
    expect(cdnSrcForWidth(src, 384)).toBe("/cdn/products/abc-w320.webp"); // a 384-wide slot no longer downloads the 640 file
    expect(cdnSrcForWidth(src, 5000)).toBe("/cdn/products/abc-w960.webp");
    expect(cdnSrcSet(src)).toBe("/cdn/products/abc-w320.webp 320w, /cdn/products/abc-w640.webp 640w, /cdn/products/abc-w960.webp 960w");
    expect(cdnSrcForWidth("/cdn/products/abc.jpg", 500)).toBe("/cdn/products/abc.jpg");
  });
  test("object keys never trust the content-type header for the extension", () => {
    expect(newObjectKey("products", "image/jpeg")).toMatch(/^products\/[0-9a-f-]{36}\.jpg$/);
    expect(newObjectKey("products", "image/webp; charset=utf-8")).toMatch(/\.webp$/);
    expect(newObjectKey("products", "text/html")).toMatch(/\.bin$/);
    expect(newObjectKey("products", "garbage")).toMatch(/\.bin$/);
  });
});

test("email HTML is escaped", () => {
  expect(escapeHtml(`<img src=x onerror="a()">&'`)).toBe("&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;");
});

test.describe("FCM sender", () => {
  test("only an explicit UNREGISTERED error marks a token dead", () => {
    const unregistered = JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } });
    const badPayload = JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload", details: [{ errorCode: "INVALID_ARGUMENT" }] } });
    const badToken = JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token", details: [{ errorCode: "INVALID_ARGUMENT" }] } });
    expect(isDeadTokenResponse(404, unregistered)).toBe(true);
    expect(isDeadTokenResponse(400, badPayload)).toBe(false); // one bad payload must never wipe every device
    expect(isDeadTokenResponse(400, badToken)).toBe(true);
    expect(isDeadTokenResponse(404, "<html>gateway</html>")).toBe(false);
    expect(isDeadTokenResponse(500, "")).toBe(false);
  });

  test("signs a valid RS256 JWT, reuses the OAuth token and clips oversized fields", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: "p", client_email: "svc@p.iam.gserviceaccount.com", private_key: privateKey });
    process.env.GOOGLE_OAUTH_TOKEN_URL = "http://oauth.test/token";
    process.env.FCM_BASE_URL = "http://fcm.test";

    const calls: Array<{ url: string; body: string; auth?: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? String(init.body) : "";
      calls.push({ url, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (url === "http://oauth.test/token") {
        const assertion = new URLSearchParams(body).get("assertion") ?? "";
        const [h, c, s] = assertion.split(".");
        const valid = crypto.createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"));
        if (!valid) return new Response("{}", { status: 401 });
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      const long = "N".repeat(5000);
      expect(await sendPush("device-token-1", { title: long, body: long, url: "/x", tag: "t" })).toBe("ok");
      expect(await sendPush("device-token-2", { title: "b", body: "b" })).toBe("ok");
      const oauth = calls.filter((c) => c.url === "http://oauth.test/token");
      expect(oauth, "token cached between sends").toHaveLength(1);
      const fcm = calls.filter((c) => c.url.startsWith("http://fcm.test/v1/projects/p/messages:send"));
      expect(fcm).toHaveLength(2);
      expect(fcm[0].auth).toBe("Bearer tok");
      const message = JSON.parse(fcm[0].body).message;
      expect(message.data.title.length).toBeLessThanOrEqual(120);
      expect(Buffer.byteLength(JSON.stringify(message.data))).toBeLessThan(4096);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
    }
  });

  test("does nothing (and does not throw) when no service account is configured", async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    expect(await sendPush("t", { title: "a", body: "b" })).toBe("error");
  });
});
