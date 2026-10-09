// The Worker that Cloudflare actually runs for the admin panel (wrangler.admin.jsonc → main). It is the plain OpenNext worker plus a
// timer that, every 3 minutes, asks for two harmless things so the owner's first click of the day is not the slow one:
//   - /api/health: a tiny database question, which wakes Neon (it sleeps after 5 idle minutes) and keeps the connection warm;
//   - /admin/login: the sign-in page, which loads the admin code path. It shows no private data and is not saved anywhere.
// No admin page is ever saved or shared: private pages change constantly and must always come from the real server.
// It also switches a practising browser onto the practice tables (see lib/practice-context.ts).
// (This file is left out of the type check, because ./.open-next/worker.js only exists after the build.)
import openNext from "./.open-next/worker.js";
import { requestIsPractising } from "./lib/practice-cookie";
import { runInPractice } from "./lib/practice-context";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const WARM_PATHS = ["/api/health", "/admin/login"];

const worker = {
  // A browser that has started the practice shop carries a signed cookie. Its whole request (and every background job it starts) runs
  // "in practice", which makes the database point at the practice tables and blocks email, WhatsApp, TCS and notifications.
  async fetch(request, env, ctx) {
    const practising = Boolean(env.PRACTICE_DATABASE_URL) && (await requestIsPractising(request, env.CRON_SECRET));
    return practising ? runInPractice(() => openNext.fetch(request, env, ctx)) : openNext.fetch(request, env, ctx);
  },
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
