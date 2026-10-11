"use client";

import { useEffect, useRef, useState } from "react";
import type { Analytics } from "@/lib/admin/analytics";
import { RANGES, type RangeKey } from "@/lib/admin/ranges";
import { Hint } from "../_ui/client";
import { HBars, HourChart, SalesChart } from "../_ui/charts";
import { Delta, EmptyState, Stat, Thumb, num, pkr } from "../_ui/ui";

/**
 * "How your shop is doing". Changing the period fetches just these numbers and swaps them in place (the old numbers stay,
 * slightly faded, until the new ones arrive) – the page does not reload and does not jump to the top.
 */
export function AnalyticsPanel({ initial, initialKey }: { initial: Analytics; initialKey: RangeKey }) {
  const [key, setKey] = useState<RangeKey>(initialKey);
  const [data, setData] = useState<Analytics>(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const cache = useRef(new Map<RangeKey, Analytics>([[initialKey, initial]]));
  const controller = useRef<AbortController | null>(null);

  async function choose(next: RangeKey) {
    if (next === key && !failed) return;
    setKey(next);
    setFailed(false);
    window.history.replaceState(null, "", `/admin?range=${next}`);
    const hit = cache.current.get(next);
    if (hit) setData(hit);
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/analytics?range=${next}`, { signal: abort.signal, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const fresh = (await response.json()) as Analytics;
      cache.current.set(next, fresh);
      setData(fresh);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setFailed(true);
    } finally {
      if (controller.current === abort) setLoading(false);
    }
  }

  useEffect(() => () => controller.current?.abort(), []);

  const { now, before } = data;
  const aov = now.orders ? now.sales / now.orders : 0;
  const aovBefore = before.orders ? before.sales / before.orders : 0;
  const rangeLabel = RANGES.find((range) => range.key === key)?.label ?? "";

  return (
    <section aria-label="How your shop is doing" aria-busy={loading}>
      <div className="a-row" style={{ justifyContent: "space-between", margin: "26px 0 12px" }}>
        <h2 style={{ fontSize: 18 }}>
          How your shop is doing <span className="a-muted" style={{ fontWeight: 400 }}>· last {rangeLabel.toLowerCase()}</span>
        </h2>
        <div className="a-range" role="group" aria-label="Choose period">
          {RANGES.map((range) => (
            <button key={range.key} type="button" aria-pressed={range.key === key} aria-current={range.key === key ? "page" : undefined} onClick={() => void choose(range.key)}>
              {range.label}
            </button>
          ))}
        </div>
      </div>
      {failed && (
        <p className="a-error" role="alert" style={{ marginBottom: 10 }}>
          Could not update the numbers. Check your internet and press the period again.
        </p>
      )}
      <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
        <div className="a-grid a-grid-4">
          <Stat label="Sales" hint={<Hint text="Total value of all orders placed in this period, not counting cancelled or returned ones." />} value={pkr(now.sales)} note={<Delta now={now.sales} before={before.sales} />} />
          <Stat label="Orders" hint={<Hint text="How many orders customers placed. Cancelled and returned orders are not counted." />} value={num(now.orders)} note={<Delta now={now.orders} before={before.orders} />} />
          <Stat label="Average order" hint={<Hint text="Sales divided by orders. If this goes up, customers are buying more in each order." />} value={pkr(aov)} note={<Delta now={aov} before={aovBefore} />} />
          <Stat label="Customers" hint={<Hint text="Different people who ordered. “New” means they had never ordered from you before." />} value={num(now.customers)} note={<span>{data.customers.fresh} new · {data.customers.returning} came back</span>} />
        </div>

        <div className="a-split" style={{ marginTop: 18 }}>
          <section className="a-card">
            <div className="a-card-head">
              <h2>Sales each day</h2>
              <small>{now.orders ? `${num(now.orders)} orders · ${pkr(now.sales)}` : "No orders in this period yet"}</small>
            </div>
            <div style={{ padding: "12px 18px 16px" }}>
              {now.orders ? <SalesChart series={data.series} /> : <EmptyState icon="chart" title="No sales in this period yet">When orders arrive, you will see them here day by day.</EmptyState>}
            </div>
          </section>
          <section className="a-card">
            <div className="a-card-head">
              <h2>Order progress</h2>
              <Hint text="What happened to the orders placed in this period." below />
            </div>
            <dl style={{ margin: 0, padding: "10px 22px 18px", display: "grid", gap: 10 }}>
              {[
                ["Delivered", now.delivered, "var(--done)"],
                ["Still on the way / being prepared", Math.max(0, now.orders - now.delivered), "var(--work)"],
                ["Cancelled or returned", now.cancelled, "var(--bad)"],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="a-row" style={{ justifyContent: "space-between" }}>
                  <dt className="a-row" style={{ gap: 8 }}>
                    <i style={{ width: 10, height: 10, borderRadius: 3, background: String(color), display: "inline-block" }} />
                    {label}
                  </dt>
                  <dd style={{ margin: 0, fontWeight: 700 }} className="a-money">
                    {num(Number(value))}
                  </dd>
                </div>
              ))}
              <div className="a-help" style={{ marginTop: 4 }}>
                {now.orders + now.cancelled > 0 ? `${Math.round((now.cancelled / (now.orders + now.cancelled)) * 100)}% of orders were cancelled or returned.` : "Nothing to report yet."}
              </div>
            </dl>
          </section>
        </div>

        <div className="a-grid a-grid-3" style={{ marginTop: 18 }}>
          <section className="a-card">
            <div className="a-card-head">
              <h2>Best sellers</h2>
              <Hint text="Products that brought in the most money in this period." below />
            </div>
            {data.products.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: "6px 18px 14px", display: "grid", gap: 10 }}>
                {data.products.map((product) => (
                  <li key={product.id ?? product.name} className="a-prodcell">
                    <Thumb src={product.image} square />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name}</strong>
                      <small className="a-muted">{product.extra} sold</small>
                    </span>
                    <span className="a-money a-strong">{pkr(product.value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="box" title="Nothing sold yet">Your best sellers will appear here.</EmptyState>
            )}
          </section>
          <section className="a-card">
            <div className="a-card-head">
              <h2>Where orders come from</h2>
              <Hint text="Cities with the most orders. Good places to offer free delivery or ads." below />
            </div>
            <div style={{ padding: "14px 20px 20px" }}>
              {data.cities.length ? <HBars items={data.cities} format={(v) => `${v} order${v === 1 ? "" : "s"}`} /> : <p className="a-muted">No orders yet.</p>}
              {data.payments.length > 0 && (
                <>
                  <h3 style={{ fontSize: 15, margin: "20px 0 10px" }}>How customers pay</h3>
                  <HBars items={data.payments} format={(v) => `${v}`} alt />
                </>
              )}
            </div>
          </section>
          <section className="a-card">
            <div className="a-card-head">
              <h2>Busiest hours</h2>
              <Hint text="The times of day customers order most (Pakistan time). A good time to post on Instagram or start a flash sale." below />
            </div>
            <div style={{ padding: "14px 18px 18px" }}>{now.orders ? <HourChart hours={data.hours} /> : <p className="a-muted">Shows up after your first orders.</p>}</div>
          </section>
        </div>
      </div>
    </section>
  );
}
