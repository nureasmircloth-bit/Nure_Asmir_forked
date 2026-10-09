import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getNonce } from "@/lib/nonce";
import { sandboxGate } from "@/lib/sandbox-gate";

const isDev = process.env.NODE_ENV !== "production";
// Lets a production build be served over plain http on localhost (e2e / `next start` smoke tests).
const allowInsecure = isDev || process.env.ALLOW_INSECURE_HTTP === "1";

/**
 * `'unsafe-inline'` stays in script-src as a fallback for browsers old enough not to understand
 * nonces at all — per spec, any browser that *does* understand `'nonce-…'` ignores
 * `'unsafe-inline'` entirely, so this is the standard, zero-downside way to keep old-browser
 * compatibility without weakening CSP for everyone else. See lib/nonce.ts for why the nonce itself
 * is a fixed secret rather than freshly generated per request.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // blob: is required for the admin campaign-image cropper, which previews the picked file
    // via URL.createObjectURL() entirely client-side before anything is uploaded.
    "img-src 'self' data: blob: https:",
    // 'unsafe-eval' is required by React Fast Refresh in dev only — never present in production.
    // static.cloudflareinsights.com is Cloudflare's own Web Analytics beacon, auto-injected into
    // every response by the zone itself (not something this app adds) — without it allowlisted
    // here, the browser silently blocks it and logs a CSP violation on every page load.
    // apis.google.com/gstatic.com are Google's Customer Reviews opt-in widget on the order
    // confirmation page (checkout/page.tsx) — it loads platform.js from apis.google.com, which in
    // turn pulls supporting resources from gstatic.com.
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ""} https://www.googletagmanager.com https://connect.facebook.net https://static.cloudflareinsights.com https://challenges.cloudflare.com https://apis.google.com https://www.gstatic.com`,
    // Inline `style={{...}}` (blur-placeholder backgrounds, etc.) is used extensively throughout
    // the storefront — nonce-ing every one of those individually isn't practical the way it is for
    // the small, fixed set of inline <script> tags, so style-src keeps 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Sentry's browser SDK spins up a small worker from a blob: URL for some features.
    "worker-src 'self' blob:",
    `connect-src 'self' ${isDev ? "ws:" : ""} https://www.google-analytics.com https://connect.facebook.net https://cloudflareinsights.com https://challenges.cloudflare.com https://apis.google.com https://*.algolia.net https://*.algolianet.com https://*.ingest.de.sentry.io https://*.ingest.sentry.io https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com`,
    // Turnstile's checkout widget renders inside an iframe from challenges.cloudflare.com; the
    // Google Customer Reviews opt-in survey itself renders inside an iframe from google.com.
    "frame-src https://challenges.cloudflare.com https://www.google.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  // A browser that is practising counts every admin request against a daily allowance first; the real shop is not touched by this.
  if (process.env.PRACTICE_DATABASE_URL) {
    const blocked = await sandboxGate(request);
    if (blocked) return blocked;
  }

  // Redirects plain HTTP to HTTPS and adds a Strict-Transport-Security header — max-age is a
  // conservative 2 years without includeSubDomains or preload: those are much harder to walk back
  // once a browser has cached the policy (up to the full max-age, even after the header is
  // removed), and this domain's other subdomains (e.g. the one used for transactional email)
  // haven't been individually confirmed to always serve valid HTTPS.
  if (!allowInsecure && request.headers.get("x-forwarded-proto") === "http") {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, 308);
  }

  // One address for the shop: "www.nureasmir.com/…" goes to "nureasmir.com/…" (a permanent redirect, so search engines keep a single copy of every page).
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (!allowInsecure && process.env.APP_TARGET !== "admin" && host.startsWith("www.")) {
    const bare = new URL(request.url);
    bare.host = host.slice(4);
    bare.protocol = "https:";
    return NextResponse.redirect(bare, 308);
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildCsp(getNonce()));
  // The admin Worker (APP_TARGET=admin) must never be indexed.
  if (process.env.APP_TARGET === "admin") response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  // Never in dev: browsers cache HSTS per host for the full max-age, which would pin localhost to https.
  if (!allowInsecure) response.headers.set("Strict-Transport-Security", "max-age=63072000");
  return response;
}

export const config = {
  // /_next/static/* never reaches middleware anyway (Cloudflare's Workers Static Assets binding
  // serves it directly — see public/_headers), but excluding it here avoids running this on every
  // asset request regardless of adapter internals.
  matcher: ["/((?!_next/static|_next/image|cdn/|favicon.ico).*)"],
};
