import Link from "next/link";
import { isOrderTab, listOrders, orderTabCounts, ORDER_TABS } from "@/lib/admin/orders-query";
import { Icon } from "../../_ui/icons";
import { EmptyState, PageHeader, Pager, Tabs } from "../../_ui/ui";
import { OrdersTable } from "./orders-table";

import { OrdersAdvancedTools } from "./orders-advanced-tools";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  const params = await searchParams;
  const tab = isOrderTab(params.tab) ? params.tab : "action";
  const q = (params.q ?? "").slice(0, 60);
  const page = Math.max(1, Number(params.page) || 1);

  const [list, counts] = await Promise.all([listOrders({ tab, q, page }), orderTabCounts()]);
  const tabInfo = ORDER_TABS.find((item) => item.key === tab)!;
  const href = (nextPage: number) => `/admin/orders?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${nextPage}`;

  return (
    <>
      <PageHeader
        title="Orders"
        intro="Every order from your website, from the moment it arrives until it reaches the customer."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <OrdersAdvancedTools />
            <Link className="a-btn a-btn-primary" href="/admin/orders/new">
              <Icon name="plus" /> New order
            </Link>
          </div>
        }
      />

      <Tabs
        items={ORDER_TABS.map((item) => ({
          href: `/admin/orders?tab=${item.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
          label: item.label,
          count: counts[item.key],
          active: item.key === tab,
          hot: item.key === "action" && counts.action > 0,
        }))}
      />

      <form method="get" action="/admin/orders" className="a-row" style={{ marginBottom: 14 }} role="search">
        <input type="hidden" name="tab" value={q ? "all" : tab} />
        <div style={{ flex: 1, maxWidth: 460 }}>
          <input name="q" defaultValue={q} placeholder="Find an order: number, customer name, phone, city, tracking…" aria-label="Find an order" />
        </div>
        <button className="a-btn">
          <Icon name="search" size={17} /> Find
        </button>
        {q && (
          <Link className="a-btn a-btn-quiet" href={`/admin/orders?tab=${tab}`}>
            Clear search
          </Link>
        )}
        <span className="a-muted">{q ? `Showing all orders matching “${q}”` : tabInfo.help}</span>
      </form>

      <div className="a-card">
        {list.rows.length ? (
          <OrdersTable rows={JSON.parse(JSON.stringify(list.rows))} tab={tab} />
        ) : (
          <EmptyState icon="orders" title={q ? "No order matches your search" : tab === "action" ? "Nothing needs you right now" : "No orders here"}>
            {q ? "Check the spelling, or try just the last digits of the phone number." : "New orders will appear here by themselves, and you will get an alert."}
          </EmptyState>
        )}
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={href} />
      </div>
    </>
  );
}
