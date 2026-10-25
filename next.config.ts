import type { NextConfig } from "next";

// Content-Security-Policy and Strict-Transport-Security are set in middleware.ts instead — CSP
// needs a fresh per-request nonce (so inline scripts can be nonce'd instead of relying on
// 'unsafe-inline' alone) and HSTS only makes sense alongside the HTTP->HTTPS redirect middleware
// also owns, so both live together there rather than split across two places.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

// Identifies this build to the service worker (/sw.js?v=…) so every deploy swaps cached pages/chunks.
const BUILD_ID = (
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  Date.now().toString(36)
).slice(0, 16);

const nextConfig: NextConfig = {
  // Synchronize internal Next.js build ID with the service worker cache version
  generateBuildId: async () => BUILD_ID,
  // Lets the e2e suite build/serve a production copy next to a running `next dev` (.next is locked by dev).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  images: {
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
  },
  // Note: this only ever reaches actual page/route requests handled by the Worker. Static assets
  // under /_next/static/* are served directly by Cloudflare's Workers Static Assets binding,
  // bypassing this entirely — their Cache-Control is set via public/_headers instead (Cloudflare's
  // own convention for that layer, same as Cloudflare Pages). A rule here targeting
  // /_next/static/* was tried first and confirmed, live, to never take effect — removed rather
  // than left in as code that looks like it works but doesn't.
  // The admin deployable has no storefront home page – its root goes straight to the panel.
  async redirects() {
    return ["admin", "training", "developer"].includes(process.env.APP_TARGET ?? "") ? [{ source: "/", destination: "/admin", permanent: false }] : [];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
