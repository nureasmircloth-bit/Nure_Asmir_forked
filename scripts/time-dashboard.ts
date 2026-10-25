// Times each query of the admin dashboard on its own (run against the disposable test branch only).
//   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/time-dashboard.ts
import { getAnalytics, getLowStock, getTodo } from "../lib/admin/analytics";

async function timed(label: string, work: () => Promise<unknown>) {
  const started = performance.now();
  await work();
  console.log(`${label.padEnd(28)} ${Math.round(performance.now() - started)} ms`);
}

/** Fails closed: only a local SQLite test file may be used (LOCAL_DB_PATH), never a real database. */
function assertDisposable(path: string): void {
  if (!path) {
    console.error("Refusing to run: set LOCAL_DB_PATH to a local test database (npm run e2e:db makes one).");
    process.exit(1);
  }
}

(async () => {
  assertDisposable(process.env.LOCAL_DB_PATH ?? "");
  await timed("warm-up (todo)", getTodo);
  await timed("getTodo", getTodo);
  await timed("getLowStock(6)", () => getLowStock(6));
  for (const range of ["7d", "30d", "90d"] as const) await timed(`getAnalytics(${range})`, () => getAnalytics(range));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1; // a failed measurement must not look like a successful run
});
