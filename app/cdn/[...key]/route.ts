import { getCloudflareContext } from "@opennextjs/cloudflare";
import { backendOf, publicBucketOrigin, r2Bucket, r2Get } from "@/lib/storage";
import { recordApiCall } from "@/lib/usage";
import { runInBackground } from "@/lib/background";

export const dynamic = "force-dynamic";

const ONE_YEAR = 31536000;

/**
 * Same-origin CDN path for the public Neon bucket (see lib/media-url.ts). Cloudflare is told to
 * cache the origin response at the edge for a year (`cf.cacheEverything`), so after the first hit
 * in a region the bytes come straight from Cloudflare's cache — Neon storage is only ever the
 * origin. Keys are random UUIDs that are never overwritten, which is what makes "immutable" safe.
 *
 * For maximum speed, point NEXT_PUBLIC_CDN_URL at a Cloudflare-proxied hostname (e.g.
 * cdn.<domain>) whose origin rule targets the bucket — that skips the Worker entirely.
 */
export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  const objectKey = key.map(encodeURIComponent).join("/");

  // Only the media prefixes are public; never expose anything else that might live in the bucket.
  if (!/^(r2\/)?(products|categories|campaign)\//.test(key.join("/"))) {
    return new Response("Not found", { status: 404 });
  }

  // Pictures kept in Cloudflare R2 (keys start with r2/): read through the Worker binding, with the edge cache in front so a
  // picture is read from R2 once per region, not once per visitor.
  if (backendOf(key.join("/")) === "r2") {
    const bucket = r2Bucket();
    if (bucket) {
      const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
      const cacheKey = new Request(new URL(request.url).origin + new URL(request.url).pathname);
      const hit = await cache?.match(cacheKey);
      if (hit) return hit;
      try {
        const object = await r2Get(key.join("/")); // the Asia-Pacific bucket, then the older one
        runInBackground(recordApiCall("r2-storage", true), "usage:r2-storage");
        if (!object) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
        const headers = new Headers({
          "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
          "Content-Length": String(object.size),
          "Cache-Control": `public, max-age=${ONE_YEAR}, immutable`,
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        });
        if (object.httpEtag) headers.set("ETag", object.httpEtag);
        const response = new Response(object.body, { status: 200, headers });
        if (cache) {
          const copy = response.clone();
          try {
            getCloudflareContext().ctx.waitUntil(cache.put(cacheKey, copy));
          } catch {
            // no execution context: skip caching
          }
        }
        return response;
      } catch (error) {
        runInBackground(recordApiCall("r2-storage", false, error instanceof Error ? error.message : String(error)), "usage:r2-storage");
        return new Response("Image temporarily unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    }
  }

  let origin: Response;
  try {
    origin = await fetch(`${publicBucketOrigin()}/${objectKey}`, {
      // `cf` is a Cloudflare Workers extension to RequestInit.
      cf: { cacheEverything: true, cacheTtl: ONE_YEAR, cacheTtlByStatus: { "200-299": ONE_YEAR, "404": 60, "500-599": 0 } },
      signal: AbortSignal.timeout(8000),
    } as RequestInit);
    if (!origin.ok && objectKey.startsWith("r2/")) {
      const fallback = await fetch(`${publicBucketOrigin()}/${objectKey.slice(3)}`, {
        cf: { cacheEverything: true, cacheTtl: ONE_YEAR, cacheTtlByStatus: { "200-299": ONE_YEAR, "404": 60, "500-599": 0 } },
        signal: AbortSignal.timeout(8000),
      } as RequestInit);
      if (fallback.ok) origin = fallback;
    }
  } catch (error) {
    console.error("CDN origin fetch failed", error);
    return new Response("Image temporarily unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  runInBackground(recordApiCall("neon-storage", origin.ok || origin.status === 404, origin.ok ? "" : `origin ${origin.status}`), "usage:neon-storage");
  if (!origin.ok || !origin.body) return new Response("Not found", { status: origin.status === 404 ? 404 : 502 });

  const headers = new Headers();
  headers.set("Content-Type", origin.headers.get("content-type") ?? "application/octet-stream");
  const length = origin.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  const etag = origin.headers.get("etag");
  if (etag) headers.set("ETag", etag);
  headers.set("Cache-Control", `public, max-age=${ONE_YEAR}, immutable`);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(origin.body, { status: 200, headers });
}
