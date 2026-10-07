// The Worker that Cloudflare actually runs for the shop (wrangler.jsonc → main). It wraps the OpenNext worker with two extras:
//   1. a nearby saved copy of public pages (lib/edge-page-cache.ts), so repeat visits skip the database in Singapore;
//   2. a timer ("cron trigger") that keeps the database awake and runs the shop's scheduled jobs on time. Cloudflare's own
//      timer is exact, unlike GitHub's, which in practice runs about every 20 minutes.
// The admin Worker does not use this file (it has no public pages and no jobs).
// (This file is left out of the type check, because ./.open-next/worker.js only exists after the build.)
import openNext from "./.open-next/worker.js";
import { withEdgePageCache } from "./lib/edge-page-cache";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const handler = withEdgePageCache(openNext, () => (typeof caches !== "undefined" ? caches.default : undefined));

/** What runs on each timer tick. Each job's own route decides whether there is anything to do, so repeat calls are harmless. */
const JOBS = [
  // every 3 minutes: wake/keep the database (Neon sleeps after 5 idle minutes) and free stock held by unconfirmed orders
  { everyMinutes: 3, path: "/api/health", secret: false },
  { everyMinutes: 3, path: "/api/cron/expire-reservations", secret: true },
  { everyMinutes: 15, path: "/api/cron/courier-sync", secret: true },
  { everyMinutes: 15, path: "/api/cron/sales", secret: true },
  { everyMinutes: 60, path: "/api/cron/maintenance", secret: true },
];

const worker = {
  fetch: handler.fetch,
  async scheduled(event, env, ctx) {
    const origin = env.NEXT_PUBLIC_SITE_URL || "https://nureasmir.com";
    const minute = Math.floor(event.scheduledTime / 60000);
    for (const job of JOBS) {
      if (minute % job.everyMinutes !== 0) continue;
      const headers = job.secret && env.CRON_SECRET ? { authorization: `Bearer ${env.CRON_SECRET}` } : {};
      // call this same Worker directly (no trip over the internet), so the answer comes from the real code and database
      ctx.waitUntil(
        openNext.fetch(new Request(`${origin}${job.path}`, { headers }), env, ctx).then(
          (response) => (response.ok ? undefined : console.error(`cron ${job.path} answered ${response.status}`)),
          (error) => console.error(`cron ${job.path} failed`, error),
        ),
      );
    }
  },
};

export default worker;
