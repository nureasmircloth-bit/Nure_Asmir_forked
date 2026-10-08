/* Nure Asmir service worker.
 *
 *  1. Browser cache for the public storefront — fast repeat visits, instant back/forward and a
 *     graceful offline fallback — with explicit freshness limits (see TTLS below).
 *  2. Firebase Cloud Messaging background handler (order updates, sale alerts, admin alerts).
 *
 * Registered as /sw.js?v=<build id>: every deploy ships a new URL, so the browser installs the new
 * worker, which discards the previous build's page/static caches (old HTML must never be paired
 * with new JS chunks). Product images are content-addressed (immutable) and survive deploys.
 *
 * Never cached: /api/*, /admin*, cart, checkout, order tracking, Next.js RSC/prefetch requests and
 * anything that is not a GET.
 */
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC_CACHE = "na-static-" + VERSION; // /_next/static/* – immutable, content-hashed
const PAGE_CACHE = "na-pages-" + VERSION; // public HTML + small cacheable API responses
const IMAGE_CACHE = "na-images-v1"; // /cdn/* – random-UUID keys, never overwritten, survives deploys
const KEEP = [STATIC_CACHE, PAGE_CACHE, IMAGE_CACHE];

const TTLS = {
  page: 5 * 60 * 1000, // HTML is shown instantly from cache for up to 5 min (and refreshed in the background); older → network first
  quietPage: 60 * 60 * 1000, // pages that hardly ever change (our story, contact, FAQ, policies): instant for an hour (the admin promises edits within minutes)
  pageMax: 7 * 24 * 60 * 60 * 1000, // offline fallback never older than a week
  api: 10 * 60 * 1000, // currency table, catalogue lookups
  image: 30 * 24 * 60 * 60 * 1000,
};
const MAX_ENTRIES = { [PAGE_CACHE]: 60, [IMAGE_CACHE]: 400, [STATIC_CACHE]: 200 };
const NETWORK_TIMEOUT = 3500;
// A returning visitor who has a saved copy waits at most this long for the network (a slow or stalled lookup must not hold the page back),
// then sees the saved copy; the fresh one is stored for next time.
const SAVED_COPY_RACE = 1500;
const QUIET_PAGE = /^\/(about|contact|faq|policies\/[a-z0-9-]+)\/?$/;

const IS_ADMIN_HOST = self.location.hostname.startsWith("admin.");

const NEVER = [/^\/api\//, /^\/admin/, /^\/cart/, /^\/checkout/, /^\/track-order/, /^\/wishlist/, /^\/search/, /^\/sw\.js/, /^\/firebase-messaging-sw\.js/, /^\/monitoring/];
const CACHEABLE_API = [/^\/api\/currency$/, /^\/api\/catalog\/by-ids$/, /^\/api\/search\/index$/];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("na-") && !KEEP.includes(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/* ---------- helpers ---------- */
function stamp(response) {
  // Responses are immutable – rebuild with a timestamp header so we can age them out.
  const headers = new Headers(response.headers);
  headers.set("x-sw-cached-at", String(Date.now()));
  return response.blob().then((body) => new Response(body, { status: response.status, statusText: response.statusText, headers }));
}
const ageOf = (response) => Date.now() - Number(response.headers.get("x-sw-cached-at") || 0);

async function put(cacheName, request, response) {
  if (!response || !response.ok || response.status !== 200) return;
  // Clone synchronously, before anything is awaited: the original is handed to the page right after
  // this call and its body can no longer be cloned once it has been read.
  const copy = response.clone();
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, await stamp(copy));
    trim(cacheName);
  } catch (error) {
    // Quota / opaque response – caching is best-effort and must never break the page.
  }
}

async function trim(cacheName) {
  const max = MAX_ENTRIES[cacheName];
  if (!max) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key);
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Cache-first for immutable assets, with an age limit. */
async function cacheFirst(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit && (!maxAge || ageOf(hit) < maxAge)) return hit;
  try {
    const response = await fetch(request);
    put(cacheName, request, response);
    return response;
  } catch (error) {
    if (hit) return hit; // stale beats nothing
    throw error;
  }
}

/** Stale-while-revalidate: answer from cache immediately while it is fresh enough, refresh behind it. */
async function staleWhileRevalidate(event, request, cacheName, ttl, hardMax, raceMs = NETWORK_TIMEOUT) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    put(cacheName, request, response);
    return response;
  });
  if (hit) {
    const age = ageOf(hit);
    if (age < ttl) {
      event.waitUntil(refresh.catch(() => {}));
      return hit;
    }
    // Older than the freshness window: prefer the network, but fall back to the cached copy when it
    // is slow/offline and not older than the hard limit.
    try {
      return await Promise.race([refresh, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), raceMs))]);
    } catch (error) {
      if (age < hardMax) return hit;
      throw error;
    }
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (IS_ADMIN_HOST || request.method !== "GET") return;

  const url = new URL(request.url);
  // Next.js client-side navigation / prefetch traffic: leave to the browser.
  if (request.headers.get("rsc") || url.searchParams.has("_rsc") || request.headers.get("next-router-prefetch")) return;

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE, 0));
    return;
  }
  // Product / category / campaign images – on this origin (/cdn/*) or a dedicated CDN host.
  if ((sameOrigin && url.pathname.startsWith("/cdn/")) || (!sameOrigin && /^cdn\./.test(url.hostname)) || (sameOrigin && /^\/(brand|logo|apple|placeholder)/.test(url.pathname))) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, TTLS.image));
    return;
  }
  if (!sameOrigin) return;

  if (CACHEABLE_API.some((re) => re.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(event, request, PAGE_CACHE, TTLS.api, TTLS.api * 6));
    return;
  }
  if (NEVER.some((re) => re.test(url.pathname))) return;

  if (request.mode === "navigate") {
    event.respondWith(
      staleWhileRevalidate(event, request, PAGE_CACHE, QUIET_PAGE.test(url.pathname) ? TTLS.quietPage : TTLS.page, TTLS.pageMax, SAVED_COPY_RACE).catch(async () => {
        const cache = await caches.open(PAGE_CACHE);
        return (await cache.match("/")) || new Response("You appear to be offline. Please reconnect and try again.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }),
    );
  }
});

/* ---------- push (Firebase Cloud Messaging) ---------- */
firebase.initializeApp({
  apiKey: "AIzaSyA6jb6Q1h5iA6uvZy5-t7pu20VPN_NGvsM",
  authDomain: "nureasmir.firebaseapp.com",
  projectId: "nureasmir",
  storageBucket: "nureasmir.firebasestorage.app",
  messagingSenderId: "731961563546",
  appId: "1:731961563546:web:24d8c83c88c195cb068223",
});
const messaging = firebase.messaging();

// Messages are data-only (see lib/push/fcm.ts), so the notification is built here.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || "Nure Asmir", {
    body: data.body || "",
    icon: "/logo-icon.png",
    badge: "/logo-icon.png",
    tag: data.tag || "nure-asmir",
    data: { url: data.url || "/" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
