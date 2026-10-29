import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";

// Without this, OpenNext's default incremental cache is "dummy" — a no-op that never actually
// stores anything. Every page marked `revalidate = N` (shop, home, contact, faq,
// policies…) was silently re-rendering from scratch, hitting the database, on every single
// request — never once served from cache — regardless of the revalidate window configured on the
// page itself. This points the cache at a small Cloudflare R2 bucket (nure-asmir-cache) used only for
// cached page renders — product / category / campaign images live in Neon Object Storage (see
// lib/storage.ts) — via the
// NEXT_INC_CACHE_R2_BUCKET binding in wrangler.jsonc.
// The regional cache keeps a copy of each cache entry in the data centre that served it (Cloudflare's
// own Cache API), so repeat page views skip the R2 round-trip entirely. "short-lived" re-uses an
// entry for at most a minute, so catalogue edits made in the admin still show up quickly.
//
// Two more pieces make "the admin changed something, the shop shows it" and "a page older than its revalidate time is rebuilt" actually work (with
// the defaults neither does, and a page that was prerendered at build time stays as it was):
//   - tagCache: remembers which tags the admin refreshed, in the `revalidations` table of the shop's D1 database (binding NEXT_TAG_CACHE_D1,
//     the same database as DB; see drizzle/0004_revalidations.sql);
//   - queue: rebuilds a stale page in the background while the old copy is served (stale-while-revalidate).
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "short-lived" }),
  tagCache: d1NextTagCache,
  queue: memoryQueue,
});
