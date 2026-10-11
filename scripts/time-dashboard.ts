// Times each query of the admin dashboard on its own (run against the disposable test branch only).
//   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/time-dashboard.ts
import { getAnalytics, getLowStock, getTodo } from "../lib/admin/analytics";

async function timed(label: string, work: () => Promise<unknown>) {
  const started = performance.now();
  await work();
  console.log(`${label.padEnd(28)} ${Math.round(performance.now() - started)} ms`);
}

(async () => {
  if (!/ep-restless-art/.test(process.env.DATABASE_URL ?? "")) throw new Error("not the test branch");
  await timed("warm-up (todo)", getTodo);
  await timed("getTodo", getTodo);
  await timed("getLowStock(6)", () => getLowStock(6));
  for (const range of ["7d", "30d", "90d"] as const) await timed(`getAnalytics(${range})`, () => getAnalytics(range));
})().catch((error) => console.error(error));
