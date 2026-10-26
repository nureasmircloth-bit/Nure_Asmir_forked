// The Worker Cloudflare runs for the developer console (wrangler.developer.jsonc → main): the plain OpenNext worker, no timers.
// (This file is left out of the type check, because ./.open-next/worker.js only exists after the build.)
import openNext from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default {
  fetch: (request, env, ctx) => openNext.fetch(request, env, ctx),
};
