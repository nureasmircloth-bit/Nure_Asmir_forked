// Builds ONE of the four deployables from this codebase, each its own Worker with its own bundle, origin and cookies:
//
//   node scripts/build-target.mjs store      → the customer-facing storefront     ("nure-asmir")
//   node scripts/build-target.mjs admin      → the owner's admin panel            ("nure-asmir-admin")   – no developer or training pages
//   node scripts/build-target.mjs training   → the practice shop for trainees     ("nure-asmir-training") – no developer pages, own database
//   node scripts/build-target.mjs developer  → the developer console + admin      ("nure-asmir-developer")
//
// Shoppers never download — or even have deployed next to them — any admin code, and the admin
// panel loads only when its link is opened (separate Worker, separate origin, own cookies/CSP/robots).
// `next dev`, tests and a plain `next build` still see the whole app; the split happens only here:
// the directories the target must not contain are moved aside for the duration of the build and put
// back afterwards (also on failure / Ctrl-C), then OpenNext bundles what is left.
//
// Extra args after the target are passed to `opennextjs-cloudflare` (default: build). Examples:
//   node scripts/build-target.mjs store            # build
//   node scripts/build-target.mjs admin deploy     # build + `wrangler deploy` via OpenNext
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
const TARGETS = ["store", "admin", "training", "developer"];
if (!TARGETS.includes(target)) {
  console.error(`Usage: node scripts/build-target.mjs <${TARGETS.join("|")}> [build|deploy|preview]`);
  process.exit(1);
}
const command = process.argv[3] || "build";

// The storefront's pages and APIs: none of them belong in an admin-side build.
const STORE_ONLY = [
  "app/(store)",
  "app/robots.ts",
  "app/sitemap.ts",
  "app/api/cart-availability",
  "app/api/catalog",
  "app/api/checkout",
  "app/api/cron",
  "app/api/currency",
  "app/api/feeds",
  "app/api/newsletter",
  "app/api/orders",
  "app/api/push",
  "app/api/revalidate",
  "app/api/search",
  "app/api/whatsapp",
];
// The developer console, and the practice shop's entrance, lab guides and daily allowance.
const DEVELOPER_ONLY = ["app/admin/(protected)/developer"];
const TRAINING_ONLY = ["app/admin/(protected)/training", "app/admin/training-start", "app/admin/training-login", "app/api/admin/sandbox"];

// Error reporting (Sentry) is built into the storefront and the owner's admin only. The training lab and the developer console are built with an
// empty DSN: they send nothing, and the Sentry code is never even requested by their pages.
const SENTRY_TARGETS = ["store", "admin"];

// Everything the other target owns. Shared pieces (root layout, db, lib, middleware, /api/media* …) stay.
const EXCLUDE = {
  // public/vendor holds the browser build of ExcelJS, which only the admin panel loads. (app/cdn – the picture route – is NOT excluded from
  // the admin build: the admin pages show product pictures from their own address, so they need it too.)
  store: ["app/admin", "app/api/admin", "public/vendor"],
  admin: [...STORE_ONLY, ...DEVELOPER_ONLY, ...TRAINING_ONLY],
  training: [...STORE_ONLY, ...DEVELOPER_ONLY],
  developer: [...STORE_ONLY, ...TRAINING_ONLY],
}[target];

const root = ".build-excluded";
const manifestPath = path.join(root, "manifest.json");
const stash = path.join(root, target);
const moved = [];

/** Moves every stashed path (from this or an interrupted earlier run) back to where it came from. */
function restore() {
  let entries = moved.splice(0).map((rel) => ({ stash, rel }));
  if (fs.existsSync(manifestPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      entries = entries.concat(saved.filter((entry) => !entries.some((e) => e.rel === entry.rel)));
    } catch {
      // unreadable manifest – fall through with what we know
    }
  }
  for (const { stash: dir, rel } of entries.reverse()) {
    const from = path.join(dir, rel);
    if (fs.existsSync(from) && !fs.existsSync(rel)) {
      fs.mkdirSync(path.dirname(rel), { recursive: true });
      fs.renameSync(from, rel);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

try {
  if (fs.existsSync(root)) {
    console.error("Found files left over from an interrupted split build — restoring them first.");
    restore();
  }
  for (const rel of EXCLUDE) {
    if (!fs.existsSync(rel)) continue;
    fs.mkdirSync(path.dirname(path.join(stash, rel)), { recursive: true });
    fs.renameSync(rel, path.join(stash, rel));
    moved.push(rel);
    // Written after every move so a crash at any point can be undone by the next run.
    fs.writeFileSync(manifestPath, JSON.stringify(moved.map((r) => ({ stash, rel: r }))));
  }
  console.log(`[${target}] excluded: ${moved.join(", ")}`);
  // Generated route types from a previous dev/other-target run would reference the excluded routes.
  fs.rmSync(".next", { recursive: true, force: true });

  const config = { store: "wrangler.jsonc", admin: "wrangler.admin.jsonc", training: "wrangler.training.jsonc", developer: "wrangler.developer.jsonc" }[target];
  const env = { ...process.env, APP_TARGET: target, NEXT_PUBLIC_APP_TARGET: target, ...(SENTRY_TARGETS.includes(target) ? {} : { NEXT_PUBLIC_SENTRY_DSN: "" }) };
  const args = ["opennextjs-cloudflare", command, "--config", config];
  const result = spawnSync("npx", args, { stdio: "inherit", env, shell: process.platform === "win32" });
  process.exitCode = result.status ?? 1;
} finally {
  restore();
}
