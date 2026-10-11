// Times each query of the admin dashboard on its own (run against the disposable test branch only).
//   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/time-dashboard.ts
import { getAnalytics, getLowStock, getTodo } from "../lib/admin/analytics";

async function timed(label: string, work: () => Promise<unknown>) {
  const started = performance.now();
  await work();
  console.log(`${label.padEnd(28)} ${Math.round(performance.now() - started)} ms`);
}

/** Fails closed: only a disposable test database may be touched, judged by the host name alone (never by words elsewhere in the URL). */
function assertDisposable(url: string): void {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // not a URL at all
  }
  if (!/^ep-restless-art-[a-z0-9]+(-pooler)?\./.test(host)) {
    console.error("Refusing to run: DATABASE_URL is not the disposable e2e test branch.");
    process.exit(1);
  }
}

(async () => {
  assertDisposable(process.env.DATABASE_URL ?? "");
  await timed("warm-up (todo)", getTodo);
  await timed("getTodo", getTodo);
  await timed("getLowStock(6)", () => getLowStock(6));
  for (const range of ["7d", "30d", "90d"] as const) await timed(`getAnalytics(${range})`, () => getAnalytics(range));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1; // a failed measurement must not look like a successful run
});
