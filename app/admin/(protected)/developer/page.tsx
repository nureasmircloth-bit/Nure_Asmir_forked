import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdminUser } from "@/lib/auth/admin-auth";
import { describeAction, predict, type Measured } from "@/lib/capacity";
import { DB_LIMIT_BYTES, formatBytes, OTHER_KEYS, SERVICES } from "@/lib/dev-limits";
import { DEFAULT_SOLDOUT_DAYS, getSoldoutDays, idleSoldOutProducts } from "@/lib/soldout-cleanup";
import { r2Bucket, STORAGE_LIMITS } from "@/lib/storage";
import { pktDay, type ServiceName } from "@/lib/usage";
import { Badge, EmptyState, PageHeader, when } from "../../_ui/ui";
import { RefreshStorage } from "./refresh-storage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Developer" };

type Rows<T> = { rows: T[] };
const rowsOf = <T,>(result: unknown): T[] => (result as Rows<T>).rows ?? [];

function Bar({ used, limit, warn = 0.8 }: { used: number; limit: number | null; warn?: number }) {
  if (!limit) return <span className="a-muted">no limit</span>;
  const ratio = Math.min(1, used / limit);
  const color = ratio >= 0.95 ? "var(--bad)" : ratio >= warn ? "var(--work)" : "var(--done)";
  return (
    <span style={{ display: "inline-grid", gap: 3, minWidth: 140 }}>
      <span className="a-progress" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} style={{ height: 8 }}>
        <i style={{ width: `${Math.max(2, ratio * 100)}%`, background: color }} />
      </span>
      <small className="a-muted">{Math.round(ratio * 100)}% used</small>
    </span>
  );
}

// Public values (NEXT_PUBLIC_…) are put into the build at build time, and only where the code names them literally – looking one up by a
// variable name finds nothing at run time. So these are written out one by one; everything else is a private setting read when the page opens.
const PUBLIC_VALUES: Record<string, string | undefined> = {
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  NEXT_PUBLIC_ALGOLIA_SEARCH_KEY: process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY,
};
const present = (name: string) => Boolean(name in PUBLIC_VALUES ? PUBLIC_VALUES[name] : process.env[name]);

export default async function DeveloperPage() {
  const user = await requireAdminUser("/admin/developer");
  if (user.role !== "developer") notFound();

  const today = pktDay();
  const monthStart = `${today.slice(0, 7)}-01`;

  const soldoutDays = (await getSoldoutDays()) || DEFAULT_SOLDOUT_DAYS;
  const [usageResult, errorResult, errorTotals, statsResult, dbSize, imageTotals, countsResult, shrinkResult] = await Promise.all([
    db.execute(sql`
      select service,
             coalesce(sum(calls) filter (where day = ${today}), 0) as "today",
             coalesce(sum(errors) filter (where day = ${today}), 0) as "errorsToday",
             coalesce(sum(calls) filter (where day >= ${monthStart}), 0) as "month",
             coalesce(sum(errors) filter (where day >= ${monthStart}), 0) as "errorsMonth",
             max(last_at) as "lastAt",
             (select e.last_error from api_usage e where e.service = api_usage.service and e.last_error <> '' order by e.last_at desc limit 1) as "lastError"
      from api_usage group by service`),
    db.execute(sql`select id, source, message, path, stack, count, first_seen_at as "firstSeen", last_seen_at as "lastSeen" from error_log order by last_seen_at desc limit 40`),
    db.execute(sql`select coalesce(sum(count) filter (where day = ${today}), 0) as "today", coalesce(sum(count) filter (where day >= date(${today}, '-6 days')), 0) as "week", count(*) as kinds from error_log`),
    db.execute(sql`select key, value, updated_at as "at" from service_stats where key like 'storage:%' or key like 'limits:%'`),
    db.execute(sql`select (select page_count from pragma_page_count) * (select page_size from pragma_page_size) as bytes`).catch(() => ({ rows: [] as Array<{ bytes: number }> })),
    db.execute(sql`select count(*) as n, coalesce(sum(byte_size), 0) as bytes, count(*) filter (where compacted_at is not null) as shrunk from product_images where status = 'active'`),
    db.execute(sql`select (select count(*) from orders) as orders, (select count(*) from products) as products`),
    db.execute(sql`select count(*) as n, coalesce(sum(i.byte_size), 0) as bytes from product_images i where i.status = 'active' and i.compacted_at is null and i.product_id in (select id from (${idleSoldOutProducts(soldoutDays)}) as idle)`),
  ]);

  const usage = new Map(rowsOf<{ service: ServiceName; today: number; errorsToday: number; month: number; errorsMonth: number; lastAt: string; lastError: string | null }>(usageResult).map((row) => [row.service, row]));
  const errors = rowsOf<{ id: string; source: string; message: string; path: string; stack: string; count: number; firstSeen: string; lastSeen: string }>(errorResult);
  const errTotals = rowsOf<{ today: number; week: number; kinds: number }>(errorTotals)[0] ?? { today: 0, week: 0, kinds: 0 };
  const stats = rowsOf<{ key: string; value: Record<string, unknown> | string; at: string }>(statsResult).map((row) => ({ ...row, value: typeof row.value === "string" ? (JSON.parse(row.value) as Record<string, unknown>) : row.value }));
  const stat = (key: string) => stats.find((row) => row.key === key);
  const dbBytes = Number(rowsOf<{ bytes: string | number }>(dbSize)[0]?.bytes ?? 0);
  const images = rowsOf<{ n: number; bytes: string | number; shrunk: number }>(imageTotals)[0] ?? { n: 0, bytes: 0, shrunk: 0 };

  const stores = (["neon", "r2"] as const).map((backend) => {
    const row = stat(`storage:${backend}`);
    const value = (row?.value ?? {}) as { bytes?: number; objects?: number };
    return { backend, label: backend === "neon" ? "Neon Storage" : "Cloudflare R2", bytes: Number(value.bytes ?? 0), objects: Number(value.objects ?? 0), limit: STORAGE_LIMITS[backend], at: row?.at, connected: backend === "neon" ? present("AWS_ENDPOINT_URL_S3") : Boolean(r2Bucket()) };
  });
  const counts = rowsOf<{ orders: number; products: number }>(countsResult)[0] ?? { orders: 0, products: 0 };
  const shrinkable = rowsOf<{ n: number; bytes: string | number }>(shrinkResult)[0] ?? { n: 0, bytes: 0 };
  const emailsPerDay = (["resend", "resend-2", "brevo"] as const).reduce((sum, name) => sum + (SERVICES[name].keys.every((key) => present(key)) ? (SERVICES[name].limit ?? 0) : 0), 0);
  const measured: Measured = {
    neon: { used: stores[0].bytes, limit: stores[0].limit },
    r2: { used: stores[1].bytes, limit: stores[1].limit },
    photoCount: images.n,
    photoBytes: Number(images.bytes),
    storedBytes: stores[0].bytes + stores[1].bytes,
    shrinkableCount: shrinkable.n,
    shrinkableBytes: Number(shrinkable.bytes),
    db: { used: dbBytes, limit: DB_LIMIT_BYTES },
    orders: counts.orders,
    products: counts.products,
    emailsPerDay,
    searchesPerMonth: SERVICES.algolia.limit ?? 10_000,
    lookupsPerDay: present("GEOAPIFY_API_KEY") ? (SERVICES.geoapify.limit ?? 3000) : 0,
  };
  const forecast = predict(measured);
  const totalUsed = stores.reduce((sum, s) => sum + s.bytes, 0);
  const totalLimit = stores.reduce((sum, s) => sum + s.limit, 0);

  return (
    <>
      <PageHeader title="Developer" intro="Errors, what each connected service has been asked to do compared with its free allowance, and how much storage is used. Only developer logins can see this page." />

      <div className="a-grid a-grid-4" style={{ marginBottom: 18 }}>
        <section className="a-card a-card-pad"><small className="a-muted">Errors today</small><h2 style={{ fontSize: 28 }}>{errTotals.today}</h2><small className="a-muted">{errTotals.week} in the last 7 days · {errTotals.kinds} kinds</small></section>
        <section className="a-card a-card-pad"><small className="a-muted">Picture storage (both stores)</small><h2 style={{ fontSize: 28 }}>{formatBytes(totalUsed)}</h2><small className="a-muted">of {formatBytes(totalLimit)} free · {formatBytes(Math.max(0, totalLimit - totalUsed))} left</small></section>
        <section className="a-card a-card-pad"><small className="a-muted">Database</small><h2 style={{ fontSize: 28 }}>{formatBytes(dbBytes)}</h2><small className="a-muted">of {formatBytes(DB_LIMIT_BYTES)} on the free plan · {formatBytes(Math.max(0, DB_LIMIT_BYTES - dbBytes))} left</small></section>
        <section className="a-card a-card-pad"><small className="a-muted">Product photos</small><h2 style={{ fontSize: 28 }}>{images.n}</h2><small className="a-muted">{formatBytes(Number(images.bytes))} originals · {images.shrunk} shrunk</small></section>
      </div>

      <section className="a-card" style={{ marginBottom: 18 }} aria-label="Capacity forecast">
        <header className="a-card-head">
          <div>
            <h2>What we can still hold</h2>
            <small>Estimates from today’s real numbers. The assumption behind each answer is shown, so you can judge it.</small>
          </div>
        </header>
        {forecast.weakest && (
          <div style={{ padding: "0 22px" }}>
            <p className="a-note warn" style={{ margin: "0 0 12px" }}>
              <strong>Runs out first: {forecast.weakest.label.toLowerCase()}</strong> – about {forecast.weakest.remaining.toLocaleString()} {forecast.weakest.unit} left. {describeAction(forecast.weakest)}
            </p>
          </div>
        )}
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Room for</th><th className="num">About</th><th>How we worked it out</th></tr></thead>
            <tbody>
              {forecast.headroom.map((item) => (
                <tr key={item.key}>
                  <td><strong>{item.label}</strong></td>
                  <td className="num a-strong">{item.remaining.toLocaleString()} <small>{item.unit}</small></td>
                  <td><small className="a-muted">{item.basis}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="a-help" style={{ padding: "0 22px 16px" }}>
          Photos: about {forecast.photos.more.toLocaleString()} more fit today{shrinkable.n > 0 ? `, roughly ${forecast.photos.moreAfterShrinking.toLocaleString()} if the ${shrinkable.n} photos of long sold-out products are made smaller (Settings → Advanced)` : ""}. One photo takes about {Math.round(forecast.photos.perPhoto / 1024)} KB with all its sizes.
        </p>
      </section>

      <section className="a-card" style={{ marginBottom: 18 }}>
        <header className="a-card-head">
          <h2>Storage</h2>
          <RefreshStorage />
        </header>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Store</th><th className="num">Files</th><th className="num">Used</th><th className="num">Left</th><th>Usage</th><th>Last measured</th></tr></thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.backend}>
                  <td><strong>{s.label}</strong>{!s.connected && <small className="a-muted"> not connected here</small>}</td>
                  <td className="num">{s.objects}</td>
                  <td className="num">{formatBytes(s.bytes)}</td>
                  <td className="num">{formatBytes(Math.max(0, s.limit - s.bytes))}</td>
                  <td><Bar used={s.bytes} limit={s.limit} /></td>
                  <td>{s.at ? when(new Date(s.at)) : <span className="a-muted">not yet – press “Measure now”</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="a-help" style={{ padding: "0 22px 16px" }}>New pictures go to whichever store has more room left. Payment proofs and refund photos always stay in Neon Storage.</p>
      </section>

      <section className="a-card" style={{ marginBottom: 18 }}>
        <header className="a-card-head"><h2>Services and keys</h2><small>Counts are requests sent by the website (plus visitors’ searches for Algolia).</small></header>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Service</th><th>Keys</th><th className="num">Today</th><th className="num">This month</th><th className="num">Failed (month)</th><th>Free allowance</th><th>Left</th></tr></thead>
            <tbody>
              {(Object.keys(SERVICES) as ServiceName[]).map((name) => {
                const info = SERVICES[name];
                const row = usage.get(name);
                const used = info.period === "day" ? (row?.today ?? 0) : info.period === "month" ? (row?.month ?? 0) : 0;
                const reported = stat(`limits:${name}`)?.value as Record<string, string> | undefined;
                const missing = info.keys.filter((key) => !present(key));
                return (
                  <tr key={name}>
                    <td>
                      <strong>{info.label}</strong>
                      {info.note && <small>{info.note}</small>}
                      {row?.lastError && <small style={{ color: "var(--bad)" }}>Last problem: {row.lastError}</small>}
                    </td>
                    <td>{info.keys.length === 0 ? <Badge tone="muted">built in</Badge> : missing.length === 0 ? <Badge tone="done">all set</Badge> : <Badge tone="new">missing {missing.length}</Badge>}{missing.length > 0 && <small>{missing.join(", ")}</small>}</td>
                    <td className="num">{row?.today ?? 0}</td>
                    <td className="num">{row?.month ?? 0}</td>
                    <td className="num">{row?.errorsMonth ?? 0}</td>
                    <td>{info.limit ? `${info.limit.toLocaleString()} ${info.unit} / ${info.period}` : "—"}{reported && <small>{Object.entries(reported).map(([k, v]) => `${k.replace(/^x-ratelimit-|^x-resend-/, "")}: ${v}`).join(" · ")}</small>}</td>
                    <td>{info.limit ? <><strong>{Math.max(0, info.limit - used).toLocaleString()}</strong><Bar used={used} limit={info.limit} /></> : <span className="a-muted">no limit</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: "8px 22px 18px", display: "grid", gap: 6 }}>
          {OTHER_KEYS.map((group) => {
            const missing = group.keys.filter((key) => !present(key));
            return (
              <li key={group.label} className="a-row" style={{ justifyContent: "space-between" }}>
                <span>{group.label}</span>
                {missing.length === 0 ? <Badge tone="done">all set</Badge> : <Badge tone="bad">missing: {missing.join(", ")}</Badge>}
              </li>
            );
          })}
        </ul>
        <p className="a-help" style={{ padding: "0 22px 16px" }}>Not counted here: Cloudflare Workers requests (100,000 a day free) and Neon compute hours – see the Cloudflare and Neon dashboards for those.</p>
      </section>

      <section className="a-card">
        <header className="a-card-head"><h2>Errors</h2><small>The same error on the same day is counted once, with how often it happened.</small></header>
        {errors.length ? (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>What went wrong</th><th>Where</th><th className="num">Times</th><th>Last seen</th></tr></thead>
              <tbody>
                {errors.map((error) => (
                  <tr key={error.id}>
                    <td>
                      <details>
                        <summary style={{ cursor: "pointer" }}><strong>{error.message.slice(0, 140)}</strong></summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "8px 0 0", maxHeight: 220, overflow: "auto" }}>{error.stack || "No details were recorded."}</pre>
                      </details>
                    </td>
                    <td><small>{error.source}</small><small>{error.path}</small></td>
                    <td className="num">{error.count}</td>
                    <td>{when(new Date(error.lastSeen))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="checkCircle" title="No errors recorded">Server errors will appear here as they happen.</EmptyState>
        )}
      </section>
    </>
  );
}
