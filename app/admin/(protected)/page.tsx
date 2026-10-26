import Link from "next/link";
import { redirect } from "next/navigation";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { adminPushDevices, campaignSlides, deliveryZones, orders, products, siteSettings } from "@/db/schema";
import { requireAdminUser } from "@/lib/auth/admin-auth";
import { getAnalytics, getLowStock, getTodo, isRangeKey } from "@/lib/admin/analytics";
import { mediaUrl } from "@/lib/media-url";
import { isTcsConfigured } from "@/lib/tcs";
import { HelpBox } from "../_ui/client";
import { Icon } from "../_ui/icons";
import { EmptyState, Note, OrderStatusBadge, PageHeader, Thumb, pkr, when } from "../_ui/ui";
import { AnalyticsPanel } from "./analytics-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

function greeting(): string {
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Karachi" }));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

async function setupChecklist() {
  const [[prod], [zones], [slides], [devices], [settings]] = await Promise.all([
    db.select({ n: count() }).from(products).where(eq(products.status, "published")),
    db.select({ n: count() }).from(deliveryZones).where(eq(deliveryZones.active, true)),
    db.select({ n: count() }).from(campaignSlides).where(eq(campaignSlides.active, true)),
    db.select({ n: count() }).from(adminPushDevices),
    db.select({ address: siteSettings.tcsShipperAddress, bank: siteSettings.bankAccountNumber }).from(siteSettings).where(eq(siteSettings.id, "store")).limit(1),
  ]);
  return [
    { done: (prod?.n ?? 0) > 0, label: "Add your first product", href: "/admin/products/new", help: "Name, photos, sizes and price — about 3 minutes." },
    { done: (zones?.n ?? 0) > 0, label: "Set your delivery charges", href: "/admin/delivery", help: "What customers pay for delivery in each city." },
    { done: (slides?.n ?? 0) > 0, label: "Put a banner on your home page", href: "/admin/pictures", help: "The big picture customers see first." },
    { done: Boolean(settings?.address), label: "Add your pickup address for TCS", href: "/admin/settings#tcs", help: "So TCS knows where to collect parcels." },
    { done: isTcsConfigured(), label: "Connect your TCS account", href: "/admin/settings#tcs", help: "Lets you book parcels with one click. Until then you can type tracking numbers by hand." },
    { done: (devices?.n ?? 0) > 0, label: "Turn on order alerts", href: "/admin/settings#alerts", help: "A pop-up on this computer when a new order arrives." },
  ];
}

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireAdminUser("/admin");
  if (user.role === "developer" && process.env.APP_TARGET !== "admin") redirect("/admin/developer"); // (the owner build has no developer console)
  const rangeParam = (await searchParams).range;
  const rangeKey = isRangeKey(rangeParam) ? rangeParam : "7d";

  const [todo, analytics, lowStock, checklist, recent] = await Promise.all([
    getTodo(),
    getAnalytics(rangeKey),
    getLowStock(6),
    setupChecklist(),
    db
      .select({ id: orders.id, orderNumber: orders.orderNumber, customerName: orders.customerName, city: orders.city, total: orders.total, orderStatus: orders.orderStatus, createdAt: orders.createdAt })
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(6),
  ]);

  const finished = checklist.every((item) => item.done);
  const name = (user.displayName ?? user.email).split(/[ @]/)[0];
  const nothingToDo = !todo.toConfirm && !todo.receipts && !todo.unbooked && !todo.refunds && !todo.outOfStock;

  const tiles = [
    { n: todo.toConfirm, title: "New orders to confirm", sub: todo.waitingLong ? `${todo.waitingLong} waiting more than 12 hours` : "Call or WhatsApp the customer, then confirm", href: "/admin/orders?tab=action", hot: todo.toConfirm > 0 },
    { n: todo.receipts, title: "Bank receipts to check", sub: "Customers who paid by bank transfer", href: "/admin/orders?tab=action", hot: todo.receipts > 0 },
    { n: todo.unbooked, title: "Orders to send with TCS", sub: "Confirmed, but no TCS tracking number yet", href: "/admin/orders?tab=pack", hot: todo.unbooked > 0 },
    { n: todo.refunds, title: "Refunds waiting", sub: "Customers asking for money back", href: "/admin/refunds", hot: todo.refunds > 0 },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${name}`}
        intro={new Date().toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Karachi" })}
        actions={
          <>
            <Link className="a-btn" href="/admin/orders/new">
              <Icon name="plus" /> New order
            </Link>
            <Link className="a-btn a-btn-primary" href="/admin/products/new">
              <Icon name="plus" /> Add product
            </Link>
          </>
        }
      />

      <HelpBox id="home">
        <ol>
          <li>
            <strong>Start with “To do now”.</strong> Each box shows how many things are waiting for you. Click a box to go straight to them.
          </li>
          <li>
            Use the <strong>search bar</strong> at the top (or press <strong>Ctrl + K</strong>) to find any order by its number, the customer&apos;s name or phone number.
          </li>
          <li>
            The numbers further down show how your shop is doing. Pick <strong>Today, 7, 30 or 90 days</strong> to change the period.
          </li>
        </ol>
      </HelpBox>

      {!finished && (
        <section className="a-card" style={{ marginBottom: 20 }} aria-label="Getting started">
          <div className="a-card-head">
            <h2>Get your shop ready</h2>
            <small>
              {checklist.filter((item) => item.done).length} of {checklist.length} done
            </small>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: "6px 10px 10px", display: "grid", gap: 2 }}>
            {checklist.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="a-row" style={{ padding: "10px 12px", borderRadius: 10, opacity: item.done ? 0.6 : 1 }}>
                  <span style={{ color: item.done ? "var(--done)" : "var(--faint)" }}>
                    <Icon name={item.done ? "checkCircle" : "info"} />
                  </span>
                  <span style={{ textDecoration: item.done ? "line-through" : "none" }}>
                    <strong>{item.label}</strong>
                    <small className="a-muted" style={{ display: "block" }}>
                      {item.help}
                    </small>
                  </span>
                  <span className="a-spacer" />
                  {!item.done && <Icon name="chevronRight" size={18} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 style={{ fontSize: 18, margin: "4px 0 12px" }}>To do now</h2>
      <div className="a-grid a-grid-4" style={{ marginBottom: 8 }}>
        {tiles.map((tile) => (
          <Link key={tile.title} href={tile.href} className={`a-todo${tile.hot ? " is-hot" : " is-clear"}`} prefetch={false}>
            <span className="n">{tile.n || "✓"}</span>
            <span>
              <strong>{tile.title}</strong>
              <small>{tile.n ? tile.sub : "Nothing waiting"}</small>
            </span>
          </Link>
        ))}
      </div>
      {todo.outOfStock > 0 || todo.lowStock > 0 ? (
        <div style={{ marginBottom: 20 }}>
          <Note tone="warn">
            <strong>{todo.outOfStock ? `${todo.outOfStock} item${todo.outOfStock === 1 ? " is" : "s are"} sold out` : ""}</strong>
            {todo.outOfStock && todo.lowStock ? " and " : ""}
            {todo.lowStock ? `${todo.lowStock} ${todo.lowStock === 1 ? "is" : "are"} running low` : ""}. <Link href="/admin/stock?show=low" style={{ textDecoration: "underline", fontWeight: 600 }}>Update the stock</Link> so customers can keep buying.
          </Note>
        </div>
      ) : nothingToDo ? (
        <div style={{ marginBottom: 20 }}>
          <Note tone="good">You are all caught up. Nothing is waiting for you right now.</Note>
        </div>
      ) : (
        <div style={{ marginBottom: 20 }} />
      )}

      <AnalyticsPanel initial={analytics} initialKey={rangeKey} />

      <div className="a-split" style={{ marginTop: 18 }}>
        <section className="a-card">
          <div className="a-card-head">
            <h2>Latest orders</h2>
            <Link className="a-btn a-btn-sm" href="/admin/orders?tab=all">
              See all orders
            </Link>
          </div>
          {recent.length ? (
            <div className="a-table-wrap">
              <table className="a-table">
                <tbody>
                  {recent.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link href={`/admin/orders/${order.id}`} className="a-strong" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
                          {order.orderNumber}
                        </Link>
                        <small>{when(order.createdAt)}</small>
                      </td>
                      <td>
                        {order.customerName}
                        <small>{order.city}</small>
                      </td>
                      <td className="num a-money">{pkr(order.total)}</td>
                      <td>
                        <OrderStatusBadge status={order.orderStatus} short />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="orders" title="No orders yet">When a customer orders, it shows up here and you get an alert.</EmptyState>
          )}
        </section>
        <section className="a-card">
          <div className="a-card-head">
            <h2>Running low</h2>
            <Link className="a-btn a-btn-sm" href="/admin/stock?show=low">
              Update stock
            </Link>
          </div>
          {lowStock.length ? (
            <ul style={{ listStyle: "none", margin: 0, padding: "6px 18px 14px", display: "grid", gap: 10 }}>
              {lowStock.map((row) => (
                <li key={`${row.productId}-${row.variant}`} className="a-prodcell">
                  <Thumb src={row.image ? mediaUrl(row.image, row.widths) : null} square />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <Link href={`/admin/products/${row.productId}`} className="a-strong">
                      {row.name}
                    </Link>
                    <small className="a-muted">{row.variant}</small>
                  </span>
                  <span className={row.available <= 0 ? "a-badge tone-bad" : "a-badge tone-new"}>{row.available <= 0 ? "Sold out" : `${row.available} left`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="checkCircle" title="Stock looks good">Nothing is running low.</EmptyState>
          )}
        </section>
      </div>
    </>
  );
}

