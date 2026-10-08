// The Worker that Cloudflare actually runs for the admin panel (wrangler.admin.jsonc → main). It is the plain OpenNext worker plus a
// timer that, every 3 minutes, asks for two harmless things so the owner's first click of the day is not the slow one:
//   - /api/health: a tiny database question, which wakes Neon (it sleeps after 5 idle minutes) and keeps the connection warm;
//   - /admin/login: the sign-in page, which loads the admin code path. It shows no private data and is not saved anywhere.
// No admin page is ever saved or shared: private pages change constantly and must always come from the real server.
// (This file is left out of the type check, because ./.open-next/worker.js only exists after the build.)
import openNext from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const WARM_PATHS = ["/api/health", "/admin/login"];

const worker = {
  fetch: openNext.fetch,
  async scheduled(_event, env, ctx) {
    const origin = env.NEXT_PUBLIC_ADMIN_URL || "https://admin.nureasmir.com";
    for (const path of WARM_PATHS) {
      ctx.waitUntil(
        openNext.fetch(new Request(`${origin}${path}`), env, ctx).then(
          (response) => (response.ok ? undefined : console.error(`warm-up ${path} answered ${response.status}`)),
          (error) => console.error(`warm-up ${path} failed`, error),
        ),
      );
    }
  },
};

export default worker;
