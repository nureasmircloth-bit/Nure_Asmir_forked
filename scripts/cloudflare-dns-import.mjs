// Copies the mail and verification records of nureasmir.com from Vercel DNS into the Cloudflare zone. Dry run unless --apply is given.
//
//   vercel api "/v5/domains/nureasmir.com/records?limit=100" > .local-db/vercel-dns.json      (the CLI prints one hint line first; it is skipped)
//   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-dns-import.mjs --zone <zone id> [--file .local-db/vercel-dns.json] [--apply]
//
// What is NOT copied, on purpose:
//   - the shop's own names (apex, www, the wildcard, "probe", admin, developer, training): they point at Vercel today. Cloudflare creates the new ones
//     itself when the Workers are attached to their custom domains (the "routes" in wrangler*.jsonc);
//   - CAA records (Vercel's three: pki.goog, sectigo.com, letsencrypt.org): without a CAA record any certificate authority may issue, which is what
//     Cloudflare's own certificates need;
//   - NS/SOA records.
// Everything else (Resend and Brevo DKIM, verification codes, DMARC, the sending CNAMEs, MX/SPF if any) is created DNS-only (never proxied) with an
// automatic TTL, unless an identical record is already there.
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? "") : undefined;
};
const zone = flag("--zone");
const file = flag("--file") ?? ".local-db/vercel-dns.json";
const apply = args.includes("--apply");
const token = process.env.CLOUDFLARE_API_TOKEN;
const DOMAIN = "nureasmir.com";
if (!zone) throw new Error("Give the Cloudflare zone id: --zone <id>");
if (apply && !token) throw new Error("Set CLOUDFLARE_API_TOKEN to apply.");

const raw = fs.readFileSync(file, "utf8");
const records = JSON.parse(raw.slice(raw.indexOf("{"))).records ?? [];

const OURS = new Set(["", "@", "www", "*", "probe", "admin", "developer", "training"]);
const wanted = records.filter((r) => {
  if (["CAA", "NS", "SOA", "ALIAS"].includes(r.type)) return false;
  if (OURS.has(r.name) && ["A", "AAAA", "CNAME"].includes(r.type)) return false;
  return true;
});

const fqdn = (name) => (name && name !== "@" ? `${name}.${DOMAIN}` : DOMAIN);
const body = (r) => ({
  type: r.type,
  name: fqdn(r.name),
  content: r.value,
  ttl: 1,
  ...(r.type === "MX" ? { priority: r.mxPriority ?? r.priority ?? 10 } : {}),
  ...(["A", "AAAA", "CNAME"].includes(r.type) ? { proxied: false } : {}),
});

async function cf(method, path, payload) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const json = await response.json();
  if (!json.success) throw new Error(`${method} ${path}: ${(json.errors ?? []).map((e) => e.message).join("; ")}`);
  return json;
}

let existing = [];
if (token) existing = (await cf("GET", "/dns_records?per_page=500")).result;
const same = (a, b) => a.type === b.type && a.name === b.name && String(a.content).replace(/\.$/, "").toLowerCase() === String(b.content).replace(/\.$/, "").toLowerCase();

let created = 0;
let skipped = 0;
for (const record of wanted) {
  const payload = body(record);
  const label = `${payload.type.padEnd(5)} ${payload.name}  ${payload.content.slice(0, 48)}${payload.content.length > 48 ? "…" : ""}`;
  if (existing.some((e) => same(e, payload))) {
    skipped++;
    console.log(`already there  ${label}`);
    continue;
  }
  if (!apply) {
    console.log(`would create   ${label}`);
    continue;
  }
  await cf("POST", "/dns_records", payload);
  created++;
  console.log(`created        ${label}`);
}
console.log(`${wanted.length} record(s) to carry over; ${apply ? `${created} created, ${skipped} already there` : "dry run (add --apply to create them)"}.`);
