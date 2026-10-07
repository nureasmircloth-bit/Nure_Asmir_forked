/**
 * Keeps finished public pages in Cloudflare's own cache, in the data centre closest to the shopper (Lahore for most customers),
 * so a repeat visit is answered in a few milliseconds without building the page or asking the database in Singapore.
 *
 * How it behaves (the same idea big shops use, "stale while revalidate"):
 *   - Fresh   (younger than FRESH_SECONDS): served straight from the cache.
 *   - Stale   (up to KEEP_SECONDS old):     served at once, and rebuilt quietly in the background for the next visitor.
 *   - Missing / too old:                    built normally, then saved.
 * The database stays the single source of truth: nothing is ever written to this cache by hand – it only holds copies of pages
 * the shop itself produced. An edit in the admin shows within about FRESH_SECONDS (the shop already works that way).
 *
 * Only public, cookie-free, successful HTML pages are saved. The cache key includes the build number, so a new release can never
 * be served pages that point at the old release's script files.
 *
 * Pure logic with an injected cache, so it is tested without Cloudflare (e2e/unit/edge-page-cache.spec.ts).
 */

export const FRESH_SECONDS = 45;
export const KEEP_SECONDS = 600;
export const CACHE_HEADER = "x-edge-cache";

/** Pages that look the same for every visitor. Everything else (cart, checkout, orders, search, API, admin) is never saved. */
const PUBLIC_PAGE = /^\/($|shop$|about$|contact$|faq$|collections\/[a-z0-9-]+$|products\/[a-z0-9-]+$|policies\/[a-z0-9-]+$)/;

/** Cookies that mean "this is a signed-in person"; such requests always go to the real server. */
const PRIVATE_COOKIE = /(^|;\s*)(admin[_-]?session|session|__session|developer[_-]?session)=/i;

export type EdgeCacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

export type EdgeHandler = {
  fetch(request: Request, env: Record<string, unknown>, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response>;
};

export function isCacheableRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.has("authorization") || request.headers.has("range")) return false;
  if (PRIVATE_COOKIE.test(request.headers.get("cookie") ?? "")) return false;
  const url = new URL(request.url);
  // Next.js asks the same address for the page itself AND for its data while moving between pages; only the page itself may be saved.
  if (url.searchParams.has("_rsc") || request.headers.has("rsc") || request.headers.has("next-router-state-tree") || request.headers.has("next-router-prefetch") || request.headers.has("next-url")) return false;
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/x-component") || accept.includes("application/json")) return false;
  return PUBLIC_PAGE.test(url.pathname);
}

/** One cache entry per page and release. Tracking parameters and filters never create new entries (the pages do not use them on the server). */
export function cacheKeyFor(request: Request, buildId: string): Request {
  const url = new URL(request.url);
  const key = new URL(`${url.origin}${url.pathname}`);
  key.searchParams.set("__build", buildId || "dev");
  return new Request(key.toString(), { method: "GET" });
}

export function isCacheableResponse(response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.headers.has("set-cookie")) return false;
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) return false;
  const control = (response.headers.get("cache-control") ?? "").toLowerCase();
  return !/(^|,\s*)(no-store|private)(\s*,|$)/.test(control);
}

/** "fresh" / "stale" / "expired" from the moment the copy was made. */
export function freshness(savedAt: number, now: number): "fresh" | "stale" | "expired" {
  const age = (now - savedAt) / 1000;
  if (!Number.isFinite(age) || age < 0) return "expired";
  if (age < FRESH_SECONDS) return "fresh";
  return age < KEEP_SECONDS ? "stale" : "expired";
}

function withMarker(response: Response, state: string, savedAt?: number): Response {
  const headers = new Headers(response.headers);
  headers.set(CACHE_HEADER, state);
  headers.delete("x-edge-saved-at");
  // Browsers always ask again (the answer comes from the nearby cache in a few milliseconds), so a visitor never keeps an old page.
  if (state !== "BYPASS") headers.set("cache-control", "public, max-age=0, must-revalidate");
  if (savedAt) headers.set("age", String(Math.max(0, Math.round((Date.now() - savedAt) / 1000))));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function saveCopy(cache: EdgeCacheLike, key: Request, response: Response): Promise<void> {
  const headers = new Headers(response.headers);
  headers.set("x-edge-saved-at", String(Date.now()));
  // The cache keeps an entry for as long as this says; freshness is decided by our own timestamp above.
  headers.set("cache-control", `public, max-age=${KEEP_SECONDS}`);
  await cache.put(key, new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}

/** Wraps the shop's handler. `enabled` is the kill switch (set EDGE_PAGE_CACHE=0 to turn it off without a code change). */
export function withEdgePageCache(handler: EdgeHandler, getCache: () => EdgeCacheLike | undefined): EdgeHandler {
  return {
    async fetch(request, env, ctx) {
      const cache = getCache();
      if (!cache || String(env.EDGE_PAGE_CACHE ?? "1") === "0" || !isCacheableRequest(request)) return handler.fetch(request, env, ctx);

      const key = cacheKeyFor(request, String(env.BUILD_ID ?? "dev"));
      const hit = await cache.match(key).catch(() => undefined);
      const savedAt = hit ? Number(hit.headers.get("x-edge-saved-at")) : 0;
      const state = hit ? freshness(savedAt, Date.now()) : "expired";

      const rebuild = async (): Promise<Response> => {
        const fresh = await handler.fetch(request, env, ctx);
        if (isCacheableResponse(fresh)) {
          // one copy goes to the cache, the other goes to the visitor
          await saveCopy(cache, key, fresh.clone()).catch(() => undefined);
          return fresh;
        }
        return fresh;
      };

      if (hit && state === "fresh") return withMarker(hit, "HIT", savedAt);
      if (hit && state === "stale") {
        ctx.waitUntil(rebuild().then((r) => r.arrayBuffer()).catch(() => undefined)); // reading it lets the saved copy finish too
        return withMarker(hit, "STALE", savedAt);
      }
      const built = await rebuild();
      return isCacheableResponse(built) ? withMarker(built, "MISS") : withMarker(built, "BYPASS");
    },
  };
}
