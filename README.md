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

## Three Workers, two builds, one repo

The customer storefront and the owner's admin panel are built and deployed as **separate Cloudflare Workers**
(`scripts/build-target.mjs`): `nure-asmir` (storefront, no admin code in the bundle) and
`nure-asmir-admin` (admin panel, own origin/cookies, `X-Robots-Tag: noindex`). Shoppers never download
admin code or admin CSS (`app/admin/admin.css` is loaded only by the admin layout); the storefront footer
links to the admin URL (`NEXT_PUBLIC_ADMIN_URL`) and nothing of it loads until that link is opened.
`npm run dev`, tests and a plain `next build` still run the whole app on one origin.

A **third Worker, `nure-asmir-training`** (`wrangler.training.jsonc`, `training.nureasmir.com`), is the admin build deployed again
in permanent practice mode (`SANDBOX=1`). It is given only the practice database connection (schema `practice`, role `practice_user`),
the picture-store keys and the shared `TRAINING_PASSWORD`, and none of the email / WhatsApp / TCS / push / search / AI keys. It holds the
lessons, six guided labs (`lib/labs.ts`, checked by read-only queries in `lib/lab-check-queries.ts`) and free practice; the real admin only
links to it. One lab is shared by everyone with the password; "Start again" resets it for all. See `docs/consultant/03-loading-and-indexing.html#sandbox`.

```bash
npm run cf:build:store     # → .open-next, deploy with: npx wrangler deploy -c wrangler.jsonc
npm run cf:build:admin     # → .open-next, deploy with: npx wrangler deploy -c wrangler.admin.jsonc
```

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

## Deployment (GitHub Actions → Cloudflare)

* `development` → CI (`.github/workflows/ci.yml`: tsc, eslint, OpenNext build) and CodeRabbit review.
* `main` → `.github/workflows/deploy.yml` builds and `wrangler deploy`s.
* Required GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`,
  `NEXT_PUBLIC_SITE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`, `CSP_NONCE`,
  `CRON_SECRET`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_KEY`, `ALGOLIA_INDEX_NAME`, `NEXT_PUBLIC_ALGOLIA_SEARCH_KEY`,
  `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY` (the public PostHog EU project key; analytics stay off without it), `TRAINING_PASSWORD` (the shared training-lab password), `PRACTICE_DATABASE_URL` (practice schema connection, made by `scripts/practice-create.ts`), `NEXT_PUBLIC_CDN_URL` (optional), plus the Resend / WhatsApp / TCS (`TCS_USERNAME`, `TCS_PASSWORD`, `TCS_ACCOUNT_NO`, `TCS_COST_CENTER_CODE`, `TCS_ENV`) /
  Firebase (`FIREBASE_SERVICE_ACCOUNT`, the whole service-account JSON) / Groq (`GROQ_API_KEY`) /
  Turnstile ones listed in `.env.example`, and `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` (S3 credentials for the ISR cache bucket only, used by `scripts/purge-isr-cache.ts`).
* The ISR page cache lives in a small Cloudflare R2 bucket, `nure-asmir-cache`
  (`npx wrangler r2 bucket create nure-asmir-cache`; the workflow does this idempotently).
* The Worker bundle must stay under Cloudflare's 3 MB gzip limit on the free plan (currently
  ≈2.9 MB) — which is why storage uses `aws4fetch` instead of the AWS SDK and Sentry's full Node SDK
  is not bundled server-side. Check with `npx wrangler deploy --dry-run` after adding dependencies.

## Cloudflare security (free plan)

`npx tsx scripts/cloudflare-harden.ts --zone <zone-id> [--apply]` (needs `CLOUDFLARE_API_TOKEN`)
configures: Full (strict) TLS, always-HTTPS, TLS ≥ 1.2, HSTS, Bot Fight Mode, browser integrity
check, managed WAF rules, a custom rule set, a login/checkout rate limit and the long-lived cache rule
for `/cdn/*`. Without `--apply` it only prints what it would do.

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
  visitor address in 15 minutes (`lib/auth/rate-limit.ts`, stored in `login_attempts`, no extra table). The address is Cloudflare's `CF-Connecting-IP`.
* `scripts/cloudflare-harden.ts` (run from Actions → "Cloudflare security + CDN host", dry run first) sets Full (strict) SSL, Always HTTPS, TLS 1.2
  minimum, Bot Fight Mode, the scanner-path and challenge rules, and one burst rate limit covering sign-in, the training entrance, OTP, orders,
  order lookups, coupons and the newsletter.
* `npm audit --omit=dev` is clean; the admin routes all check the signed-in user; the training lab only holds the practice connection.
