// Copies the shop's runtime secrets into the Cloudflare Workers (`wrangler secret put`, value piped on stdin; no value is ever printed).
//
//   node scripts/push-worker-secrets.mjs store admin developer training
//
// Values are read exactly the way Next.js reads them (@next/env: .env.production.local, .env.local, .env.production, .env; quotes, escapes and
// comments handled by its own dotenv). Put values that are not in .env.local (email, WhatsApp, TCS, Turnstile ...) in .env.production.local, which
// git ignores. A name that has no value is reported and skipped, never set to an empty string. The exit status is 1 when any wrangler call failed.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import nextEnv from "@next/env";

const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
nextEnv.loadEnvConfig(process.cwd(), false);
const env = process.env;

// Everything the store, the admin and the developer console read at run time (the deploy workflow sets the same list from GitHub secrets).
const SHOP = [
  "SESSION_SECRET", "ADMIN_EMAIL", "CRON_SECRET", "CSP_NONCE",
  "AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION",
  "ALGOLIA_APP_ID", "ALGOLIA_ADMIN_KEY", "FIREBASE_SERVICE_ACCOUNT", "GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_3", "GEOAPIFY_API_KEY",
  "RESEND_API_KEY", "RESEND_API_KEY_2", "RESEND_FROM_EMAIL", "RESEND_FROM_NAME", "BREVO_API_KEY", "EMAIL_REPLY_TO",
  "TURNSTILE_SECRET_KEY", "WHATSAPP_DEFAULT_NUMBER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "TCS_USERNAME", "TCS_PASSWORD", "TCS_ACCOUNT_NO", "TCS_COST_CENTER_CODE", "TCS_ENV", "TCS_SERVICE_CODE",
];
// The training lab never receives a real service key. Its pictures live in its own R2 bucket (binding MEDIA_R2), so it needs no Neon Storage
// credentials either (those open the real shop's public pictures and the private payment proofs). TRAINING_PASSWORD is set by hand:
//   npx wrangler secret put TRAINING_PASSWORD -c wrangler.training.jsonc
// AWS_ENDPOINT_URL_S3 is only the public address of the picture bucket (not a key): it lets the lab show the demo pictures, which are read-only there.
const TRAINING = ["CSP_NONCE", "AWS_ENDPOINT_URL_S3"];
// Left over from earlier deploys (Neon Storage keys, and the old practice database URLs from before the move to D1): removed from the training Worker so nothing real stays there.
// ADMIN_INITIAL_PASSWORD is only for the seed script run on a laptop; the app never reads it, so no Worker keeps a plain-text password.
const SHOP_REMOVE = ["ADMIN_INITIAL_PASSWORD"];
const TRAINING_REMOVE = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "DATABASE_URL", "PRACTICE_DATABASE_URL"];
const config = { store: "wrangler.jsonc", admin: "wrangler.admin.jsonc", developer: "wrangler.developer.jsonc", training: "wrangler.training.jsonc" };

if (!targets.length || targets.some((t) => !config[t])) {
  console.error(`Usage: node scripts/push-worker-secrets.mjs <${Object.keys(config).join("|")}> ...`);
  process.exit(2);
}

let failures = 0;
const wrangler = (verb, name, target, input) =>
  spawnSync("npx", ["wrangler", "secret", verb, name, "-c", config[target]], { input, shell: true, encoding: "utf8" });

for (const target of targets) {
  const names = target === "training" ? TRAINING : SHOP;
  const values = Object.fromEntries(names.map((name) => [name, env[name]]));
  if (target === "training") values.SESSION_SECRET = crypto.randomBytes(32).toString("hex"); // its own, never the real shop's
  let ok = 0;
  const missing = [];
  for (const [name, value] of Object.entries(values)) {
    if (!value) {
      missing.push(name);
      continue;
    }
    if (wrangler("put", name, target, value).status === 0) ok++;
    else {
      failures++;
      console.log(`FAILED ${target} ${name}`);
    }
  }
  for (const name of target === "training" ? TRAINING_REMOVE : SHOP_REMOVE) {
    if (wrangler("delete", name, target, "y\n").status !== 0 && target === "training") console.log(`(training: ${name} was not there, or could not be removed)`);
  }
  console.log(`${target}: ${ok} secrets set; no value found for: ${missing.join(", ") || "none"}`);
}
if (failures) {
  console.error(`${failures} secret(s) could not be set.`);
  process.exitCode = 1;
}
