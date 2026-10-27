// Run from the project folder:  node scripts/push-worker-secrets.mjs store admin developer training
// Copies the shop's runtime secrets from .env.local into the Workers (wrangler secret put, value piped on stdin; nothing is printed).
// usage: node scripts/push-worker-secrets.mjs <store|admin|developer|training> ...
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const SHOP = ["SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_INITIAL_PASSWORD", "AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION",
  "ALGOLIA_APP_ID", "ALGOLIA_ADMIN_KEY", "FIREBASE_SERVICE_ACCOUNT", "CRON_SECRET", "GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_3", "GEOAPIFY_API_KEY", "CSP_NONCE"];
const TRAINING = ["AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "CSP_NONCE"];
const config = { store: "wrangler.jsonc", admin: "wrangler.admin.jsonc", developer: "wrangler.developer.jsonc", training: "wrangler.training.jsonc" };

for (const target of process.argv.slice(2)) {
  const names = target === "training" ? TRAINING : SHOP;
  const values = Object.fromEntries(names.map((n) => [n, env[n]]));
  if (target === "training") values.SESSION_SECRET = crypto.randomBytes(32).toString("hex"); // its own, never the real shop's
  let ok = 0;
  const missing = [];
  for (const [name, value] of Object.entries(values)) {
    if (!value) { missing.push(name); continue; }
    const r = spawnSync("npx", ["wrangler", "secret", "put", name, "-c", config[target]], { input: value, shell: true, encoding: "utf8" });
    if (r.status === 0) ok++; else console.log(`FAILED ${target} ${name}`);
  }
  console.log(`${target}: ${ok} secrets set; not set (no value in .env.local): ${missing.join(", ") || "none"}`);
}
