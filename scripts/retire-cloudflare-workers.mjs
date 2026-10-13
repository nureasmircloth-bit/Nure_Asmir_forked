// Closes the three Cloudflare Workers that used to run the shop (the site now runs on Vercel and DNS is served by Vercel).
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/retire-cloudflare-workers.mjs            # only LISTS what exists (safe)
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/retire-cloudflare-workers.mjs --delete   # really deletes them
//
// Why: a Worker keeps its timer (cron trigger) even when no visitor reaches it. These Workers had a timer every 3 minutes that called the
// site (now on Vercel), which is pure wasted usage. Deleting a Worker also removes its timer, its workers.dev address and its custom domains.
// The code stays in git, so nothing is lost; the picture buckets (R2) are NOT touched. Prints no secrets.
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const really = process.argv.includes("--delete");
const NAMES = ["nure-asmir", "nure-asmir-admin", "nure-asmir-training"];
if (!token || !account) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
  process.exit(1);
}
const API = "https://api.cloudflare.com/client/v4";
const call = async (method, path) => {
  const response = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return response.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${response.status}` }] }));
};
const why = (result) => result.errors?.map((error) => error.message).join("; ") || "unknown error";

const scripts = await call("GET", `/accounts/${account}/workers/scripts`);
if (!scripts.success) {
  console.error("::error::Could not list Workers: " + why(scripts) + " (the token needs Workers Scripts: Edit on the account)");
  process.exit(1);
}
const existing = new Set((scripts.result ?? []).map((script) => script.id));
console.log("Workers on the account:", [...existing].join(", ") || "(none)");

const domains = await call("GET", `/accounts/${account}/workers/domains`);
const domainList = domains.success ? domains.result ?? [] : [];

let failed = false;
for (const name of NAMES) {
  if (!existing.has(name)) {
    console.log(`- ${name}: not there (already gone)`);
    continue;
  }
  const timers = await call("GET", `/accounts/${account}/workers/scripts/${name}/schedules`);
  const crons = timers.success ? (timers.result?.schedules ?? []).map((schedule) => schedule.cron) : ["(could not read)"];
  const attached = domainList.filter((domain) => domain.service === name).map((domain) => domain.hostname);
  console.log(`- ${name}: timers ${JSON.stringify(crons)}, custom domains ${JSON.stringify(attached)}`);
  if (!really) continue;
  for (const domain of domainList.filter((item) => item.service === name)) {
    const removed = await call("DELETE", `/accounts/${account}/workers/domains/${domain.id}`);
    console.log(`    custom domain ${domain.hostname}: ${removed.success ? "detached" : "could not detach (" + why(removed) + ")"}`);
  }
  const deleted = await call("DELETE", `/accounts/${account}/workers/scripts/${name}?force=true`);
  console.log(`    ${name}: ${deleted.success ? "DELETED" : "NOT deleted (" + why(deleted) + ")"}`);
  if (!deleted.success) failed = true;
}
console.log(really ? (failed ? "\nSome Workers could not be deleted." : "\nDone: the Workers are closed.") : "\nList only: nothing was changed. Re-run with --delete to close them.");
process.exit(failed ? 1 : 0);
