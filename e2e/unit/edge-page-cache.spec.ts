import { expect, test } from "@playwright/test";
import { CACHE_HEADER, FRESH_SECONDS, KEEP_SECONDS, QUIET_FRESH_SECONDS, QUIET_KEEP_SECONDS, cacheKeyFor, freshness, isQuietPage, isCacheableRequest, isCacheableResponse, withEdgePageCache, type EdgeCacheLike } from "../../lib/edge-page-cache";

const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), settle: () => Promise.all(pending) };
};
function fakeCache(): EdgeCacheLike & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    async match(request) {
      return store.get(request.url)?.clone();
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
}
const page = (body = "<html>hi</html>", headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://nureasmir.com${path}`, { headers });

test.describe("edge page cache", () => {
  test("only public pages are eligible – never the cart, checkout, orders, search, API or admin", () => {
    for (const ok of ["/", "/shop", "/about", "/contact", "/faq", "/collections/shirts", "/products/olive-cargo-pants", "/policies/returns"]) expect(isCacheableRequest(get(ok)), ok).toBe(true);
    for (const no of ["/cart", "/checkout", "/wishlist", "/track-order", "/search", "/api/orders", "/api/catalog/page", "/admin", "/products/", "/products/a/b", "/_next/static/x.js"]) expect(isCacheableRequest(get(no)), no).toBe(false);
  });

  test("requests that carry a person's identity, or ask for page data instead of the page, always go to the real server", () => {
    expect(isCacheableRequest(new Request("https://nureasmir.com/shop", { method: "POST" }))).toBe(false);
    expect(isCacheableRequest(get("/shop", { authorization: "Bearer x" }))).toBe(false);
    expect(isCacheableRequest(get("/shop", { cookie: "admin_session=abc" }))).toBe(false);
    expect(isCacheableRequest(get("/shop", { cookie: "theme=dark; session=abc" }))).toBe(false);
    expect(isCacheableRequest(get("/shop", { cookie: "theme=dark" }))).toBe(true); // harmless cookies do not matter
    expect(isCacheableRequest(get("/shop?_rsc=1abc"))).toBe(false);
    expect(isCacheableRequest(get("/shop", { rsc: "1" }))).toBe(false);
    expect(isCacheableRequest(get("/shop", { "next-router-prefetch": "1" }))).toBe(false);
    expect(isCacheableRequest(get("/shop", { accept: "text/x-component" }))).toBe(false);
    expect(isCacheableRequest(get("/shop", { range: "bytes=0-9" }))).toBe(false);
  });

  test("tracking and filter parameters never create separate copies, and every release has its own copies", () => {
    const a = cacheKeyFor(get("/shop?utm_source=fb&fbclid=1&sort=low"), "abc123").url;
    const b = cacheKeyFor(get("/shop"), "abc123").url;
    expect(a).toBe(b);
    expect(cacheKeyFor(get("/shop"), "abc123").url).not.toBe(cacheKeyFor(get("/shop"), "def456").url);
    expect(cacheKeyFor(get("/shop"), "").url).toContain("__build=dev");
  });

  test("only successful, cookie-free, public HTML is saved", () => {
    expect(isCacheableResponse(page())).toBe(true);
    expect(isCacheableResponse(new Response("x", { status: 404, headers: { "content-type": "text/html" } }))).toBe(false);
    expect(isCacheableResponse(new Response("x", { status: 500, headers: { "content-type": "text/html" } }))).toBe(false);
    expect(isCacheableResponse(new Response("x", { status: 301, headers: { "content-type": "text/html", location: "/" } }))).toBe(false);
    expect(isCacheableResponse(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))).toBe(false);
    expect(isCacheableResponse(page("x", { "set-cookie": "a=b" }))).toBe(false);
    expect(isCacheableResponse(page("x", { "cache-control": "private, max-age=0" }))).toBe(false);
    expect(isCacheableResponse(page("x", { "cache-control": "no-store" }))).toBe(false);
    expect(isCacheableResponse(page("x", { "cache-control": "s-maxage=24, stale-while-revalidate=100" }))).toBe(true);
  });

  test("a copy is fresh, then stale (served while a new one is built), then too old", () => {
    const t = 1_000_000_000;
    expect(freshness(t, t + 1000)).toBe("fresh");
    expect(freshness(t, t + (FRESH_SECONDS - 1) * 1000)).toBe("fresh");
    expect(freshness(t, t + FRESH_SECONDS * 1000)).toBe("stale");
    expect(freshness(t, t + (KEEP_SECONDS - 1) * 1000)).toBe("stale");
    expect(freshness(t, t + KEEP_SECONDS * 1000)).toBe("expired");
    expect(freshness(NaN, t)).toBe("expired");
    expect(freshness(t + 5000, t)).toBe("expired"); // a copy "from the future" is never trusted
  });

  test("pages that hardly change stay fresh longer and are kept for a week; shop pages do not", () => {
    const t = 1_000_000_000;
    for (const path of ["/about", "/contact", "/faq", "/policies/returns"]) expect(isQuietPage(path), path).toBe(true);
    for (const path of ["/", "/shop", "/collections/shirts", "/products/olive-cargo-pants"]) expect(isQuietPage(path), path).toBe(false);
    expect(freshness(t, t + (FRESH_SECONDS + 5) * 1000, true)).toBe("fresh"); // would already be stale for a shop page
    expect(freshness(t, t + (FRESH_SECONDS + 5) * 1000, false)).toBe("stale");
    expect(freshness(t, t + QUIET_FRESH_SECONDS * 1000, true)).toBe("stale");
    expect(freshness(t, t + (QUIET_KEEP_SECONDS - 1) * 1000, true)).toBe("stale");
    expect(freshness(t, t + QUIET_KEEP_SECONDS * 1000, true)).toBe("expired");
  });

  test("first visit builds the page, the next one is answered from the copy without touching the server", async () => {
    const cache = fakeCache();
    let built = 0;
    const handler = withEdgePageCache({ fetch: async () => (built++, page(`<html>build ${built}</html>`)) }, () => cache);
    const first = await handler.fetch(get("/shop"), { BUILD_ID: "r1" }, ctx());
    expect(first.headers.get(CACHE_HEADER)).toBe("MISS");
    expect(await first.text()).toContain("build 1");
    const second = await handler.fetch(get("/shop?utm_source=x"), { BUILD_ID: "r1" }, ctx());
    expect(second.headers.get(CACHE_HEADER)).toBe("HIT");
    expect(await second.text()).toContain("build 1");
    expect(built).toBe(1);
    expect(second.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  test("a stale copy is served at once and rebuilt in the background", async () => {
    const cache = fakeCache();
    let built = 0;
    const handler = withEdgePageCache({ fetch: async () => (built++, page(`<html>build ${built}</html>`)) }, () => cache);
    await handler.fetch(get("/shop"), { BUILD_ID: "r1" }, ctx());
    const key = cacheKeyFor(get("/shop"), "r1").url;
    cache.store.get(key)!.headers.set("x-edge-saved-at", String(Date.now() - (FRESH_SECONDS + 5) * 1000));
    const c = ctx();
    const answer = await handler.fetch(get("/shop"), { BUILD_ID: "r1" }, c);
    expect(answer.headers.get(CACHE_HEADER)).toBe("STALE");
    expect(await answer.text()).toContain("build 1"); // the visitor does not wait for the rebuild
    await c.settle();
    expect(built).toBe(2);
    const next = await handler.fetch(get("/shop"), { BUILD_ID: "r1" }, ctx());
    expect(await next.text()).toContain("build 2");
  });

  test("a new release never sees pages saved by the old one", async () => {
    const cache = fakeCache();
    let built = 0;
    const handler = withEdgePageCache({ fetch: async () => (built++, page(`<html>build ${built}</html>`)) }, () => cache);
    await handler.fetch(get("/"), { BUILD_ID: "old" }, ctx());
    const fresh = await handler.fetch(get("/"), { BUILD_ID: "new" }, ctx());
    expect(fresh.headers.get(CACHE_HEADER)).toBe("MISS");
    expect(built).toBe(2);
  });

  test("errors, redirects and private pages are passed through and never saved", async () => {
    const cache = fakeCache();
    const handler = withEdgePageCache({ fetch: async (request) => (new URL(request.url).pathname === "/faq" ? new Response("oops", { status: 500, headers: { "content-type": "text/html" } }) : page()) }, () => cache);
    const broken = await handler.fetch(get("/faq"), {}, ctx());
    expect(broken.status).toBe(500);
    expect(broken.headers.get(CACHE_HEADER)).toBe("BYPASS");
    expect(cache.store.size).toBe(0);
    const cart = await handler.fetch(get("/cart"), {}, ctx());
    expect(cart.headers.get(CACHE_HEADER)).toBeNull(); // not even touched
    expect(cache.store.size).toBe(0);
  });

  test("the kill switch and a missing cache both fall back to the plain server", async () => {
    let built = 0;
    const plain = { fetch: async () => (built++, page()) };
    const off = withEdgePageCache(plain, () => fakeCache());
    await off.fetch(get("/shop"), { EDGE_PAGE_CACHE: "0" }, ctx());
    await off.fetch(get("/shop"), { EDGE_PAGE_CACHE: "0" }, ctx());
    expect(built).toBe(2);
    const none = withEdgePageCache(plain, () => undefined);
    await none.fetch(get("/shop"), {}, ctx());
    expect(built).toBe(3);
  });

  test("a broken cache never breaks the shop", async () => {
    const broken: EdgeCacheLike = { match: async () => Promise.reject(new Error("down")), put: async () => Promise.reject(new Error("down")) };
    const handler = withEdgePageCache({ fetch: async () => page("<html>ok</html>") }, () => broken);
    const answer = await handler.fetch(get("/shop"), {}, ctx());
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("ok");
  });
});
