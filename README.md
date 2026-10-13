# Nure Asmir — storefront & admin

Pakistani men's wear e-commerce site ("Tradition in a modern form"): Next.js 16 (App Router) on
Cloudflare Workers via OpenNext, Neon Postgres + Object Storage + Auth, Algolia search (with a built-in MiniSearch fallback), TCS
courier, WhatsApp order confirmation. The storefront design follows the *Ismail Farid* benchmark:
a calm, white, image-led layout.

## Stack

| Concern | Service |
| --- | --- |
| Hosting / CDN / WAF | Cloudflare Workers (OpenNext) + Cloudflare edge cache |
| Database | Neon Postgres (`neondb`, Singapore `ap-southeast-1`) via Drizzle + `neon-http` |
| Images & files | Neon Object Storage — `nure-asmir-media` (public) and `nure-asmir-private` (payment proofs) |
| Auth | Neon Auth (Managed Better Auth) is enabled on the project; the admin panel currently uses its own session auth (`lib/auth`) |
| Search | Algolia (`nure_asmir_products`), instant overlay + `/search`. If Algolia's free allowance runs out (HTTP 429/403) or it is unreachable, the browser switches to a MiniSearch engine that is fetched **only then** (`lib/search/`) |
| Currency | Frankfurter API (display only — orders are charged in PKR) |
| Errors | Sentry (browser SDK + lightweight server reporter) |
| Email / WhatsApp / courier | Resend / WhatsApp Cloud API / TCS (E-COM API, `lib/tcs.ts`) |
| Writing helper | Groq (`GROQ_API_KEY`) — product descriptions + SEO text |

Next.js 16 has breaking changes versus older versions — read `node_modules/next/dist/docs/` before
changing framework-level code (see `AGENTS.md`).

## Local development

```bash
npm install
cp .env.example .env.local        # then fill in (or `neon env pull` for the Neon values)
npm run db:migrate                # apply Drizzle migrations to the Neon branch in .env.local
npm run db:seed                   # admin owner, settings, categories, catalogue, banners (uploads photos)
npm run search:reindex            # push the catalogue into Algolia
npm run dev                       # http://localhost:3000
```

> On Windows the in-app browser may force https for `localhost`; use `http://anything.localhost:3000`.

Useful scripts: `npm run cf:preview` (run the real Worker bundle locally), `npm run brand:assets`
(regenerate favicon / OG / logo files from `nure_asmir_assets/web`), `npm run db:generate` after a
schema change.

## Images: conversion, storage and CDN

* Every upload is converted to a ladder of WebP widths (320 / 640 / 960 / 1280 / 1600, never
  upscaled) plus a blur placeholder. In the admin this happens **in the browser**
  (`lib/client-image-processing.ts`) so the Worker does no codec work; `scripts/seed.ts` does the same
  with `sharp`.
* Originals and variants are stored in the Neon public bucket under random UUID keys that are never
  overwritten → safe to cache forever (`Cache-Control: public, max-age=31536000, immutable`).
* `lib/media-url.ts` builds the URLs and `lib/images.ts` is the `next/image` loader: it picks the
  smallest variant that covers the rendered width straight from the key (no DB lookup, no image
  service).
* Delivery: by default through `/cdn/*` (`app/cdn/[...key]/route.ts`), which streams from the bucket
  with Cloudflare's edge cache forced on (`cf.cacheEverything`, 1 year). For the lowest latency set
  `NEXT_PUBLIC_CDN_URL=https://cdn.<domain>` and run `scripts/cloudflare-harden.ts` — it creates a
  proxied `cdn` hostname whose origin rule points at the bucket, so images never touch the Worker.
* Orphans are cleaned daily by `scripts/storage-audit.ts` (GitHub Action *Storage orphan cleanup*).

## Neon

`neon.ts` declares the services (auth + the two buckets); apply with `neon deploy`. The project is
linked in `.neon` (git-ignored): project `blue-bread-34552165`, branch `production`.

## Search

`lib/search/algolia.ts` builds records, settings and synonyms (kameez/qameez, tee/t-shirt…). Admin
product/variant/image/category routes re-index on change; a nightly workflow calls
`/api/cron/search-reindex`. The browser only ever sees the **search-only** key.

## Hosting: Vercel (one project, three hostnames)

The whole app (shop, admin, training lab) is one Next.js project deployed to **Vercel** (project `nure-asmir`, region `sin1` in `vercel.json`), and the
domain's nameservers are Vercel's (`ns1/ns2.vercel-dns.com`): Cloudflare no longer serves DNS or runs any code for this site. The same deployment answers
`nureasmir.com` (shop), `admin.nureasmir.com` and `training.nureasmir.com`; `middleware.ts` sends the bare admin address (and any non-admin path) to `/admin`
and marks the admin host `noindex`. Shoppers never download admin code or CSS (`app/admin/admin.css` is loaded only by the admin layout).

* **Scheduled jobs** (reservation expiry, TCS sync, sale alerts, daily maintenance) are called by GitHub Actions (`.github/workflows/cron.yml`, every 30 minutes)
  with `CRON_SECRET`; there is no timer left on Cloudflare.
* **The old Cloudflare Workers** (`nure-asmir`, `nure-asmir-admin`, `nure-asmir-training`) are retired. Their code (`wrangler*.jsonc`, `worker-entry.ts`,
  `admin-entry.ts`, `open-next.config.ts`, the `cf:*` scripts) is kept in git for now but nothing deploys it. To close the live Workers, run Actions →
  "Retire Cloudflare Workers (one time)" (list first, then tick "delete").
* **The training lab** (`/admin/training*`, lessons, six guided labs in `lib/labs.ts`, free practice) runs on the practice tables when the deployment has
  `SANDBOX=1`, `DATABASE_URL` = the practice connection and `TRAINING_PASSWORD`. That needs its **own Vercel project** on `training.nureasmir.com` (a project
  cannot be both the real admin and a practice copy, because that switch is per deployment, not per hostname). See `docs/consultant/03-loading-and-indexing.html#sandbox`.

## Shopper experience details

* **Never oversold.** Stock is reserved with a guarded `UPDATE … WHERE stock − reserved ≥ qty`; a
  reservation is released on cancel / expiry, converted to a sale on delivery, and a 5-minute cron repairs
  any drift (`reconcileReservedStock`). Checkout is idempotent per bag (a dropped connection or a closed tab
  can never create a second order).
* **Flash sales** (admin → Flash sales): percentage / fixed discounts over a time window for chosen products or
  everything. The *server* decides the price at order time; pages show a countdown and a −% badge. When a
  sale goes live the cron pushes to shoppers who saved the product (wishlist) or asked for sale alerts.
* **Wishlist** (browser-local, optional push for sale alerts) and **order updates** (paid / on its way /
  delivered / cancelled) by push (Firebase) and email.
* **Owner alerts** (admin push): new orders, payment receipts, low stock, out of stock.
* **Browser cache**: `public/sw.js` – stale-while-revalidate pages (5 min fresh, then network-first; 7-day offline fallback), immutable chunks/images, 10-minute
  API cache, offline fallback, per-deploy cache versioning; never caches admin/API/cart/checkout/tracking.

## Testing

```bash
npx playwright install            # once
npm run test:e2e                  # unit + API/race + UI on 7 device profiles
npx playwright test --project=api # server-side: last-piece races, idempotency, pricing, push (mock FCM)
npx playwright test --project=mobile-safari --project=small-android e2e/ui/layout.spec.ts
# service-worker / cache behaviour needs a production build:
NEXT_DIST_DIR=.next-prod npx next build && E2E_PROD=1 npx playwright test --project=pwa
```

The suite refuses to run unless `DATABASE_URL` points at the disposable Neon branch `e2e-test` (set in the
git-ignored `.env.development.local`); Algolia, email and WhatsApp are switched off for it; push
notifications go to a local mock of Google's OAuth + FCM endpoints (`e2e/support/mock-fcm.mjs`) and TCS to a local mock
(`e2e/support/mock-tcs.mjs`).

## Deployment (GitHub Actions → Vercel)

* `development` → CI (`.github/workflows/ci.yml`: tsc, eslint, build) and CodeRabbit review. Work goes through pull requests; nothing is pushed straight to `main`.
* `main` → `.github/workflows/deploy.yml`: checks the Vercel secrets, applies database migrations (`drizzle-kit migrate`, then the practice tables with
  `scripts/practice-migrate.ts`), then `vercel deploy --prod`.
* GitHub secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `PRACTICE_DATABASE_URL` (optional,
  made by `scripts/practice-create.ts`) and the storage keys used by the practice seed. The app's own runtime settings (`SESSION_SECRET`, `ADMIN_EMAIL`,
  `CSP_NONCE`, storage, Algolia, Firebase, Groq, Turnstile, Resend/Brevo, WhatsApp, TCS, `NEXT_PUBLIC_*`, …) live in the **Vercel project's environment variables**
  (`vercel env ls`); the full list of names is in `.env.example`. Keep service tokens that the app does not read (for example any Cloudflare token) out of it.
* Pictures: `/cdn/r2/…` is answered from Neon storage when the old Cloudflare R2 bucket is not there (`app/cdn/[...key]/route.ts`).
* `.github/workflows/dns-watch.yml` is an optional manual check that every hostname resolves on public resolvers.

## Cloudflare (retired)

Cloudflare is not used for DNS or hosting any more. The zone for `nureasmir.com` may still exist on the account, unused; it can be deleted once the email
records (Brevo `_domainkey`, `orders`, `rsend`) have been copied to Vercel DNS. Security headers and the CSP are set by the app (`middleware.ts`) and by
`vercel.json`; guessing limits live in the app (`lib/auth/rate-limit.ts`).

## Content to confirm with the client

Prices, sizes, stock levels, product copy and the policy pages (shipping, returns, privacy, terms)
are working placeholders — edit them in the admin panel. The leather wallet / card-holder photos
supplied show another brand's logo, so those two products are seeded as **draft**.

## The admin panel (`/admin`, laptop only)

Built for daily use by a non-technical owner: plain wording, a hint (?) next to every unfamiliar word, a
"How this page works" box on every screen, light / night colours and a larger-text switch (cookies), Ctrl+K
search, and a friendly "please open this on a laptop" screen below 1024 px.

* **Home** – to-do tiles (orders to confirm, receipts, parcels to book, refunds), sales / orders / average order /
  customers with previous-period comparison, daily chart, best sellers, cities, busiest hours, low stock
  (`lib/admin/analytics.ts`, hand-drawn SVG charts, no client JS).
* **Orders** – tabs by job (Needs you → To pack & send → With TCS → Delivered → Cancelled), search, tick boxes for bulk
  confirm / book with TCS, one-click next step, order page with WhatsApp/call/copy, packing slip, CSV export.
* **Cancelling** – only until TCS has the parcel (`lib/order-rules.ts`). `orders.handed_over_at` is set when TCS scans it
  (cron sync) or the owner presses "TCS has collected it"; the guarded UPDATE in `lib/order-actions.ts` makes a cancel
  and a pickup racing each other resolve to exactly one winner. Customers cancel from *Track your order*.
* **Refunds** – customers ask from *Track your order* (reason, photos, payout account) within the refund window
  (Settings, default 7 days); a paid order that is cancelled/returned opens one automatically. Owner approves /
  declines / marks refunded with a payment reference (`lib/refunds.ts`).
* **TCS** – `lib/tcs.ts` (token cache, book, cancel, reverse, track, label) and `lib/courier.ts`; with no credentials the
  owner types the tracking number by hand. `TCS_ENV=production` only after TCS approves UAT. Endpoints follow the
  *TCS API User Guide v1.0*; the login/label GET calls pass parameters in the query string — confirm both in UAT.
* **Products** – one-page editor (photos, sizes, price, stock, "write it for me" + "improve for Google" via Groq),
  **Excel / Google Sheets bulk upload** (`/admin/products/bulk`: template with dropdowns, row-by-row plain-English
  errors, photo matching by file name, new categories created on request) and **price & stock update by sheet**.
  ExcelJS is *not* in the app bundle: `scripts/copy-vendor.mjs` copies its browser build to `public/vendor/` and the
  page loads it only when a button is pressed.
* **Website pictures** – home banners, category pictures and two single-slot pictures (`site_images`: "Our story" photo,
  share image). Every owner change refreshes the storefront cache (`lib/storefront-cache.ts` → `/api/revalidate`).
* **Settings** – contact + social links (also in the footer / JSON-LD), TCS pickup details + connection test,
  bank, free-delivery threshold, refund window, and a "what is connected" checklist.

## Visitor analytics (PostHog)

`lib/analytics.ts` is a tiny sender (no library, nothing downloaded) that posts a few events to PostHog's EU address: page views, `added_to_bag`,
`order_placed`, `card_photo_changed`, `gallery_photo_changed`. It sends **nothing** until the visitor presses "Allow analytics" in the cookie banner
(`app/analytics-consent.tsx`), forgets the random browser id when they say no, and never sends names, phones or addresses. The storefront only: the
admin and the training lab do not track. `https://eu.i.posthog.com` is allowed in the CSP (`middleware.ts`). Look at the results with
`posthog-cli login` (EU) or in the PostHog web app.

## Load testing with lots of data

`scripts/load-seed.ts` fills the **disposable e2e test branch** (it refuses to run on anything else) with 1,500 products (3 sizes and 3 photos
each) and 8,000 orders, all tagged (`lt-` slugs, `LT-` order numbers) so `--clean` removes them again:

```bash
node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/load-seed.ts            # fill
node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/load-seed.ts --clean    # remove
node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/time-dashboard.ts       # time each dashboard query
```

Run the browser tests only on a **cleaned** database: the fake photos do not exist, so "every page renders cleanly" and the Excel tests fail on purpose-less noise.

What it found and fixed (1,500 products, 8,000 orders, production build, ~150 ms of every figure is the round trip to Neon in Singapore):

| Page | Before | After |
|---|---|---|
| Admin dashboard (7 / 30 / 90-day analytics) | 3.3 s / 10 s / 16 s | 0.5 s / 0.4 s / 0.2 s (the "new vs returning customers" query compared every phone with every order; it is now one pass) |
| Search page | 1.9 s, whole catalogue loaded (171 KB) | 0.4 s, only the matching products are read |
| Shop pages 1 to 62, sorting, filters | 0.15 to 0.35 s | unchanged (24 per page, edge-cached for a minute) |
| Admin orders (page 1 / page 200 / search) | 0.3 s | unchanged (paged, 25 per page) |

Known scaling points (fine today, worth a look past a few thousand products): `GET /api/admin/products` returns every product at once (605 KB at
1,500; used by the flash-sale picker), and the built-in search engine builds an index of the whole catalogue the first time it is used on a
cold server (only when Algolia is off or out of allowance).

## Security notes

* Public lookups that could be guessed (order number + phone on track / cancel / refund, coupon codes) pause after 25 wrong guesses from one
  visitor address in 15 minutes (`lib/auth/rate-limit.ts`, stored in `login_attempts`, no extra table). A place is reserved before the lookup (so
  parallel requests cannot all slip through) and given back when the lookup finds something. The address is Cloudflare's `CF-Connecting-IP`.
  The daily maintenance job deletes attempts older than a day.
* `scripts/cloudflare-harden.ts` (run from Actions → "Cloudflare security + CDN host", dry run first) sets Full (strict) SSL, Always HTTPS, TLS 1.2
  minimum, Bot Fight Mode, the scanner-path and challenge rules, and one burst rate limit covering sign-in, the training entrance, OTP, orders,
  order lookups, coupons and the newsletter.
* `npm audit --omit=dev` is clean; the admin routes all check the signed-in user; the training lab only holds the practice connection.

## Database tuning (migration 0030)

Found by running `EXPLAIN (ANALYZE)` on the hot queries with 1,500 products and 8,000 orders. At that size the database itself answers in 0.1 to 7 ms
(the rest of a page time is the trip to Neon), so the changes are about staying fast as the shop grows. All are additive indexes:

| Index | Why |
|---|---|
| `products_published_order_idx` (partial: published, newest first) | the shop and home page read a page straight off the index (3.3 ms → 0.3 ms); note `DESC` means `NULLS FIRST` in Postgres, so the index is built that way |
| `variants_default_idx`, `images_primary_idx` (partial) | every product card joins its default size and main photo |
| `orders_status_created_idx` (replaces `orders_status_idx`) | an admin tab is "this status, newest first" (0.4 ms → 0.1 ms) |
| `orders_phone_digits_idx` (on `regexp_replace(customer_phone, '\D', '', 'g')`) | customers type 0300…, +92300… or 92300…; reports and lookups compare digits only, and an expression index matches that exactly. No extra column: a generated column would break the training lab's "Start again" (it re-inserts saved rows) |
| `order_items_product_idx`, `order_items_variant_idx`, `images_variant_idx`, `flash_sale_products_product_idx`, `product_collections_collection_idx`, `idempotency_order_idx` | foreign keys that had no index: deleting a product or size scanned these tables |
| `login_attempts_bucket_idx` | the guessing limiter looks up (bucket, address, time) |

Also: the dashboard's "top products" now counts by product, not by name (renaming a product used to split its sales in two). Not done on purpose:
trigram indexes for search (they need the `pg_trgm` extension, which the training lab's restricted database user cannot use; Algolia answers search and
the database fallback is small), and temporary tables (the Neon HTTP driver has no session, so a temporary table would vanish between calls; the
dashboard runs its queries in parallel instead).
