import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, refundRequests } from "@/db/schema";
import { PAYOUT_METHODS, REFUND_STATUS_INFO, refundReasonLabel } from "@/lib/order-rules";
import { HelpBox } from "../../_ui/client";
import { EmptyState, PageHeader, RefundStatusBadge, Tabs, fullDate, pkr, when } from "../../_ui/ui";
import { CopyButton } from "../orders/order-panels";
import { RefundActions } from "./refund-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Refunds" };

const TABS = [
  { key: "open", label: "Needs you", statuses: ["requested", "approved"] },
  { key: "done", label: "Refunded", statuses: ["refunded"] },
  { key: "declined", label: "Declined", statuses: ["rejected"] },
  { key: "all", label: "All", statuses: ["requested", "approved", "refunded", "rejected"] },
] as const;

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ tab?: string; open?: string }> }) {
  const params = await searchParams;
  const tab = TABS.find((item) => item.key === params.tab) ?? TABS[0];

  const [rows, countRows] = await Promise.all([
    db
      .select({
        refund: refundRequests,
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        orderStatus: orders.orderStatus,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        orderTotal: orders.total,
        paymentMethod: orders.paymentMethod,
        courierTrackingNumber: orders.courierTrackingNumber,
      })
      .from(refundRequests)
      .innerJoin(orders, eq(orders.id, refundRequests.orderId))
      .where(inArray(refundRequests.status, [...tab.statuses]))
      .orderBy(desc(refundRequests.createdAt))
      .limit(100),
    db.select({ status: refundRequests.status, n: sql<number>`count(*)` }).from(refundRequests).groupBy(refundRequests.status),
  ]);
  const count = (statuses: readonly string[]) => countRows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.n, 0);

  return (
    <>
      <PageHeader title="Refunds" intro="Customers who want their money back. You decide, you send the money, and you mark it done here." />
      <HelpBox id="refunds">
        <ol>
          <li>
            A customer asks for a refund from the <strong>Track your order</strong> page within the refund time you set in Settings (7 days by default). You get an alert.
          </li>
          <li>
            Read the reason and look at their photos. Press <strong>Approve</strong> or <strong>Decline</strong> (and say why — the customer sees your reason).
          </li>
          <li>
            If the item must come back, book a return with TCS and save its tracking number. Then send the money to the account shown, and press <strong>Mark as refunded</strong> with the payment reference.
          </li>
        </ol>
      </HelpBox>
      <Tabs items={TABS.map((item) => ({ href: `/admin/refunds?tab=${item.key}`, label: item.label, count: count(item.statuses), active: item.key === tab.key, hot: item.key === "open" && count(item.statuses) > 0 }))} />

      {rows.length ? (
        <div className="a-stack">
          {rows.map(({ refund, ...order }) => {
            const method = PAYOUT_METHODS.find((item) => item.value === refund.payoutMethod)?.label ?? refund.payoutMethod;
            return (
              <article key={refund.id} className="a-card" style={params.open === refund.id ? { borderColor: "var(--primary)", borderWidth: 2 } : undefined} id={`refund-${refund.id}`}>
                <header className="a-card-head">
                  <div className="a-row">
                    <h2>
                      <Link href={`/admin/orders/${order.orderId}`} style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
                        {order.orderNumber}
                      </Link>{" "}
                      · {pkr(refund.amount)}
                    </h2>
                    <RefundStatusBadge status={refund.status} />
                  </div>
                  <small>Asked {when(refund.createdAt)}</small>
                </header>
                <div className="a-card-pad a-grid a-grid-3" style={{ gap: 22 }}>
                  <div className="a-stack" style={{ gap: 6 }}>
                    <p className="a-muted a-strong" style={{ fontSize: 13.5 }}>Customer</p>
                    <p>
                      <strong>{order.customerName}</strong>
                      <br />
                      {order.customerPhone}
                    </p>
                    <p className="a-muted">
                      Order total {pkr(order.orderTotal)} · {order.paymentMethod === "cod" ? "cash on delivery" : "bank transfer"}
                    </p>
                  </div>
                  <div className="a-stack" style={{ gap: 6 }}>
                    <p className="a-muted a-strong" style={{ fontSize: 13.5 }}>Why</p>
                    <p>
                      <strong>{refundReasonLabel(refund.reason)}</strong>
                    </p>
                    {refund.details && <p style={{ whiteSpace: "pre-wrap" }}>“{refund.details}”</p>}
                    {refund.photoKeys.length > 0 && (
                      <p className="a-row">
                        {refund.photoKeys.map((_, index) => (
                          <a key={index} className="a-btn a-btn-sm" href={`/api/admin/refunds/${refund.id}/photo?i=${index}`} target="_blank" rel="noopener noreferrer">
                            Photo {index + 1}
                          </a>
                        ))}
                      </p>
                    )}
                  </div>
                  <div className="a-stack" style={{ gap: 6 }}>
                    <p className="a-muted a-strong" style={{ fontSize: 13.5 }}>Send the money to</p>
                    {refund.payoutAccount ? (
                      <>
                        <p>
                          <strong>{method}</strong>
                          <br />
                          {refund.payoutAccount}
                          <br />
                          <span className="a-muted">{refund.payoutTitle}</span>
                        </p>
                        <div>
                          <CopyButton text={refund.payoutAccount} label="Copy account number" />
                        </div>
                      </>
                    ) : (
                      <p className="a-muted">The customer has not given payment details yet. WhatsApp them and ask where to send the money, or ask them to add it on the Track your order page.</p>
                    )}
                  </div>
                </div>
                {(refund.adminNote || refund.returnTrackingNumber || refund.status === "refunded") && (
                  <div className="a-card-pad" style={{ borderTop: "1px solid var(--line)", display: "grid", gap: 4 }}>
                    {refund.adminNote && <p><span className="a-muted">Your note: </span>{refund.adminNote}</p>}
                    {refund.returnTrackingNumber && <p><span className="a-muted">Return parcel (TCS): </span><strong>{refund.returnTrackingNumber}</strong></p>}
                    {refund.status === "refunded" && <p><span className="a-muted">Sent: </span><strong>{pkr(refund.refundedAmount ?? refund.amount)}</strong> on {fullDate(refund.refundedAt)} · reference <strong>{refund.refundReference}</strong></p>}
                  </div>
                )}
                {(refund.status === "requested" || refund.status === "approved") && (
                  <footer className="a-card-pad" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)", borderRadius: "0 0 12px 12px" }}>
                    <p className="a-muted" style={{ marginBottom: 12 }}>{REFUND_STATUS_INFO[refund.status].help}</p>
                    <RefundActions id={refund.id} status={refund.status} amount={refund.amount} orderTotal={order.orderTotal} hasReturn={Boolean(refund.returnTrackingNumber)} />
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="a-card">
          <EmptyState icon="refund" title={tab.key === "open" ? "No refund requests waiting" : "Nothing here yet"}>
            When a customer asks for their money back, the request will appear here and you will get an alert.
          </EmptyState>
        </div>
      )}
    </>
  );
}
