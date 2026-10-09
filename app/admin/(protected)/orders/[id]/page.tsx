import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orderStatusHistory, orders, paymentProofs, productImages, refundRequests } from "@/db/schema";
import { mediaUrl } from "@/lib/media-url";
import { cancelBlockReason, cancelReasonLabel, customerFacingCourierStatus, STATUS_INFO } from "@/lib/order-rules";
import { codAmountFor, defaultWeightKg } from "@/lib/courier";
import { isTcsConfigured } from "@/lib/tcs";
import { toWhatsAppPhone } from "@/lib/whatsapp";
import { ApiButton } from "../../../_ui/client";
import { Icon } from "../../../_ui/icons";
import { Badge, Note, OrderStatusBadge, RefundStatusBadge, Thumb, fullDate, pkr, when } from "../../../_ui/ui";
import { BookTcsButton, CancelOrderButton, CopyButton, EditDetailsButton, ManualTrackingButton, PrivateNote, ProofButtons } from "../order-panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order" };

const STEPS = [
  { key: "pending_confirmation", label: "Placed" },
  { key: "confirmed", label: "Confirmed" },
  { key: "packed", label: "Packed" },
  { key: "shipped", label: "With TCS" },
  { key: "delivered", label: "Delivered" },
] as const;

function stepIndex(status: string): number {
  if (status === "processing") return 2;
  const index = STEPS.findIndex((step) => step.key === status);
  return index === -1 ? (status === "returned" ? 3 : 0) : index;
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) notFound();

  const [items, history, proofs, [refund]] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)),
    db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, id)).orderBy(asc(orderStatusHistory.createdAt)),
    db.select().from(paymentProofs).where(eq(paymentProofs.orderId, id)),
    db.select().from(refundRequests).where(eq(refundRequests.orderId, id)).limit(1),
  ]);

  // Orders do not store a picture of their own, so show each product's main photo (the order lines only remember the product).
  const productIds = [...new Set(items.map((item) => item.productId).filter((value): value is string => !!value))];
  const photos = productIds.length
    ? await db
        .select({ productId: productImages.productId, key: productImages.r2Key, widths: productImages.variantWidths })
        .from(productImages)
        .where(and(inArray(productImages.productId, productIds), eq(productImages.isPrimary, true), eq(productImages.status, "active")))
    : [];
  const photoOf = new Map(photos.map((photo) => [photo.productId, mediaUrl(photo.key, photo.widths)]));

  const info = STATUS_INFO[order.orderStatus];
  const tracking = order.courierTrackingNumber && order.courierTrackingNumber !== "PENDING" ? order.courierTrackingNumber : null;
  const blocked = cancelBlockReason(order);
  const editable = !order.handedOverAt && ["pending_confirmation", "confirmed", "processing", "packed"].includes(order.orderStatus);
  const pieces = items.reduce((sum, item) => sum + item.quantity, 0) || 1;
  const connected = isTcsConfigured();
  const wa = toWhatsAppPhone(order.customerPhone);
  const waText = encodeURIComponent(
    order.orderStatus === "pending_confirmation"
      ? `Assalam o Alaikum ${order.customerName}, this is Nure Asmir. We received your order ${order.orderNumber} (PKR ${order.total.toLocaleString("en-PK")}). Please confirm your address: ${order.address}, ${order.city}. Reply YES to confirm. Thank you!`
      : `Assalam o Alaikum ${order.customerName}, this is Nure Asmir about your order ${order.orderNumber}.`,
  );
  const stopped = order.orderStatus === "cancelled" || order.orderStatus === "returned";
  const current = stepIndex(order.orderStatus);

  const next = (() => {
    switch (order.orderStatus) {
      case "pending_confirmation":
        return { title: "Confirm this order with the customer", text: "Call or WhatsApp the customer to check the address and size. When they agree, press Confirm.", button: <ApiButton url={`/api/admin/orders/${id}/status`} body={{ toStatus: "confirmed" }} label="Confirm order" busyLabel="Confirming…" variant="primary" size="lg" icon="check" success="Order confirmed. The customer has been told." /> };
      case "confirmed":
      case "processing":
      case "packed":
        return tracking
          ? { title: "Waiting for TCS to collect it", text: "When the TCS rider takes the parcel, press the button. (If TCS is connected this happens by itself within a few minutes.) After that the order can no longer be cancelled.", button: <ApiButton url={`/api/admin/orders/${id}/status`} body={{ toStatus: "shipped" }} label="TCS has collected it" busyLabel="Saving…" variant="primary" size="lg" icon="truck" success="Marked as with TCS." confirm={{ title: "Has TCS taken the parcel?", body: "Once TCS has it, this order can no longer be cancelled.", confirmLabel: "Yes, TCS has it" }} /> }
          : { title: "Pack it and send it with TCS", text: "Pack the parcel, then book it with TCS to get a tracking number.", button: <BookTcsButton orderId={id} connected={connected} defaults={{ phone: order.customerPhone, city: order.city, address: order.address, cod: codAmountFor(order), pieces, weight: defaultWeightKg(pieces) }} /> };
      case "shipped":
        return { title: "On its way to the customer", text: "TCS is delivering it. It will be marked Delivered automatically when TCS confirms. You can also mark it yourself.", button: <ApiButton url={`/api/admin/orders/${id}/status`} body={{ toStatus: "delivered" }} label="Mark as delivered" busyLabel="Saving…" variant="primary" icon="checkCircle" success="Marked as delivered." confirm={{ title: "Mark as delivered?", body: "Do this only when the customer has received the parcel.", confirmLabel: "Yes, delivered" }} /> };
      default:
        return null;
    }
  })();

  return (
    <>
      <p style={{ marginBottom: 10 }}>
        <Link href="/admin/orders" className="a-muted" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          ← All orders
        </Link>
      </p>
      <header className="a-head">
        <div>
          <h1 className="a-row" style={{ gap: 12 }}>
            {order.orderNumber} <OrderStatusBadge status={order.orderStatus} />
          </h1>
          <p>
            Placed {fullDate(order.createdAt)} · {pieces} item{pieces === 1 ? "" : "s"} · <strong>{pkr(order.total)}</strong> · {order.paymentMethod === "cod" ? "Cash on delivery" : "Bank transfer"}
          </p>
        </div>
        <div className="a-head-actions a-no-print">
          <Link className="a-btn" href={`/admin/orders/${id}/slip`} target="_blank" title="Print a packing slip to put in the parcel">
            <Icon name="print" /> Packing slip
          </Link>
        </div>
      </header>

      <div className="a-card a-card-pad" style={{ marginBottom: 18 }} aria-label="Order progress">
        <ol className="a-steps">
          {STEPS.map((step, index) => (
            <li key={step.key} className={stopped ? (index < current ? "done" : "") : index < current ? "done" : index === current ? "now" : ""}>
              <i>{index < current && !stopped ? "✓" : index + 1}</i>
              {step.label}
            </li>
          ))}
          {stopped && (
            <li className="stop">
              <i>✕</i>
              {order.orderStatus === "cancelled" ? "Cancelled" : "Returned"}
            </li>
          )}
        </ol>
      </div>

      <div className="a-split">
        <div className="a-stack">
          {next && (
            <section className="a-card a-card-pad" style={{ borderColor: "var(--primary)", borderWidth: 2 }}>
              <p className="a-muted" style={{ fontSize: 13.5, fontWeight: 600 }}>
                WHAT TO DO NEXT
              </p>
              <h2 style={{ fontSize: 20, margin: "4px 0 6px" }}>{next.title}</h2>
              <p className="a-muted" style={{ marginBottom: 16, maxWidth: 640 }}>
                {next.text}
              </p>
              <div className="a-row">
                {next.button}
                {order.orderStatus === "pending_confirmation" && wa && (
                  <a className="a-btn a-btn-lg" href={`https://wa.me/${wa}?text=${waText}`} target="_blank" rel="noopener noreferrer">
                    <Icon name="whatsapp" /> WhatsApp the customer
                  </a>
                )}
                {tracking == null && ["confirmed", "processing", "packed"].includes(order.orderStatus) && <ManualTrackingButton orderId={id} />}
              </div>
              {!connected && ["confirmed", "processing", "packed"].includes(order.orderStatus) && !tracking && (
                <div style={{ marginTop: 14 }}>
                  <Note tone="warn">
                    TCS is not connected yet, so one-click booking is switched off. Book the parcel on the TCS website, then press <strong>I booked it on the TCS website</strong> and type the tracking number. You can connect TCS in <Link href="/admin/settings#tcs" style={{ textDecoration: "underline" }}>Settings</Link>.
                  </Note>
                </div>
              )}
            </section>
          )}

          {order.orderStatus === "cancelled" && (
            <Note tone="bad">
              <strong>This order was cancelled</strong> {order.cancelledAt ? when(order.cancelledAt) : ""} by {order.cancelledBy === "customer" ? "the customer" : order.cancelledBy === "system" ? "the system (it was not confirmed in time)" : order.cancelledBy}. {order.cancelReason ? <>Reason: {cancelReasonLabel(order.cancelReason)}.</> : null}
            </Note>
          )}

          <section className="a-card">
            <header className="a-card-head">
              <h2>Items</h2>
            </header>
            <div className="a-table-wrap">
              <table className="a-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Code</th>
                    <th className="num">Price</th>
                    <th className="num">Qty</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="a-prodcell">
                          <Thumb src={item.imageUrl ?? (item.productId ? photoOf.get(item.productId) : null)} />
                          <span>
                            {item.productId ? (
                              <Link href={`/admin/products/${item.productId}`} className="a-strong">
                                {item.productName}
                              </Link>
                            ) : (
                              <strong>{item.productName}</strong>
                            )}
                            <small>{item.variantName}</small>
                          </span>
                        </div>
                      </td>
                      <td>{item.sku}</td>
                      <td className="num a-money">{pkr(item.unitPrice)}</td>
                      <td className="num">{item.quantity}</td>
                      <td className="num a-money">{pkr(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl style={{ margin: 0, padding: "14px 22px 18px", display: "grid", gap: 6, justifyContent: "end", textAlign: "right" }}>
              <div className="a-row" style={{ justifyContent: "space-between", gap: 40 }}><dt className="a-muted">Items</dt><dd style={{ margin: 0 }} className="a-money">{pkr(order.subtotal)}</dd></div>
              <div className="a-row" style={{ justifyContent: "space-between", gap: 40 }}><dt className="a-muted">Delivery</dt><dd style={{ margin: 0 }} className="a-money">{order.deliveryCharge ? pkr(order.deliveryCharge) : "Free"}</dd></div>
              {order.discount > 0 && <div className="a-row" style={{ justifyContent: "space-between", gap: 40 }}><dt className="a-muted">Discount</dt><dd style={{ margin: 0 }} className="a-money">− {pkr(order.discount)}</dd></div>}
              <div className="a-row" style={{ justifyContent: "space-between", gap: 40, fontSize: 18, fontWeight: 700 }}><dt>Total</dt><dd style={{ margin: 0 }} className="a-money">{pkr(order.total)}</dd></div>
            </dl>
          </section>

          <section className="a-card">
            <header className="a-card-head">
              <h2>Payment</h2>
              <Badge tone={order.paymentStatus === "paid" ? "done" : "new"}>{order.paymentStatus === "paid" ? "Paid" : order.paymentMethod === "cod" ? "Customer pays the rider" : "Not paid yet"}</Badge>
            </header>
            <div className="a-card-pad a-stack" style={{ gap: 12 }}>
              <p>{order.paymentMethod === "cod" ? "Cash on delivery — the TCS rider collects the money and TCS pays you later." : "Bank transfer — the customer sends a photo of the receipt, and you check that the money arrived in your account."}</p>
              {order.paymentMethod === "bank_deposit" && !proofs.length && order.paymentStatus !== "paid" && <Note tone="warn">The customer has not uploaded a receipt yet.</Note>}
              {proofs.map((proof) => (
                <div key={proof.id} className="a-row" style={{ justifyContent: "space-between" }}>
                  <span>
                    Receipt sent {when(proof.createdAt)} · <Badge tone={proof.status === "approved" ? "done" : proof.status === "rejected" ? "bad" : "new"}>{proof.status === "approved" ? "Marked correct" : proof.status === "rejected" ? "Marked not correct" : "Waiting for you"}</Badge>
                  </span>
                  <ProofButtons proofId={proof.id} status={proof.status} />
                </div>
              ))}
            </div>
          </section>

          <section className="a-card">
            <header className="a-card-head">
              <h2>What happened</h2>
            </header>
            <ul className="a-timeline" style={{ padding: "18px 22px" }}>
              {[...history].reverse().map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.fromStatus === entry.toStatus ? "Note" : STATUS_INFO[entry.toStatus]?.label ?? entry.toStatus}</strong>
                  {entry.note ? ` — ${entry.note}` : ""}
                  <small>
                    {fullDate(entry.createdAt)} · {entry.actorEmail === "system" ? "automatic" : entry.actorEmail === "customer" ? "the customer" : entry.actorEmail}
                  </small>
                </li>
              ))}
              {!history.length && <li>Order placed.</li>}
            </ul>
          </section>
        </div>

        <aside className="a-stack">
          <section className="a-card">
            <header className="a-card-head">
              <h2>Customer</h2>
              {editable && <EditDetailsButton orderId={id} hasTracking={Boolean(tracking)} initial={{ customerName: order.customerName, customerPhone: order.customerPhone, customerEmail: order.customerEmail ?? "", city: order.city, province: order.province, address: order.address, deliveryNotes: order.deliveryNotes ?? "" }} />}
            </header>
            <div className="a-card-pad a-stack" style={{ gap: 14 }}>
              <div>
                <strong style={{ fontSize: 17 }}>{order.customerName}</strong>
                <div className="a-row" style={{ marginTop: 4 }}>
                  <a href={`tel:${order.customerPhone.replace(/\s/g, "")}`} className="a-strong">
                    {order.customerPhone}
                  </a>
                  <CopyButton text={order.customerPhone} />
                </div>
                <div className="a-row" style={{ marginTop: 6 }}>
                  <a className="a-btn a-btn-sm" href={`tel:${order.customerPhone.replace(/\s/g, "")}`}>
                    <Icon name="phone" size={15} /> Call
                  </a>
                  {wa && (
                    <a className="a-btn a-btn-sm" href={`https://wa.me/${wa}?text=${waText}`} target="_blank" rel="noopener noreferrer">
                      <Icon name="whatsapp" size={15} /> WhatsApp
                    </a>
                  )}
                </div>
                {order.customerEmail && <p className="a-muted" style={{ marginTop: 6 }}>{order.customerEmail}</p>}
              </div>
              <div>
                <p className="a-muted" style={{ fontWeight: 600, fontSize: 13.5 }}>Delivery address</p>
                <p>
                  {order.address}
                  <br />
                  {order.city}, {order.province}
                </p>
                {order.deliveryLatitude != null && order.deliveryLongitude != null && (
                  <p>
                    <a href={`https://www.google.com/maps?q=${order.deliveryLatitude},${order.deliveryLongitude}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
                      Open the customer’s pin in Google Maps ↗
                    </a>
                  </p>
                )}
                <CopyButton text={`${order.customerName}\n${order.customerPhone}\n${order.address}, ${order.city}`} label="Copy name, phone & address" />
                {order.deliveryNotes && <p className="a-note" style={{ marginTop: 8 }}><Icon name="info" /><span>Customer note: {order.deliveryNotes}</span></p>}
              </div>
            </div>
          </section>

          <section className="a-card">
            <header className="a-card-head">
              <h2>TCS parcel</h2>
              {tracking ? <Badge tone="ship">Booked</Badge> : <Badge tone="muted">Not booked</Badge>}
            </header>
            <div className="a-card-pad a-stack" style={{ gap: 12 }}>
              {tracking ? (
                <>
                  <div>
                    <p className="a-muted" style={{ fontSize: 13.5, fontWeight: 600 }}>Tracking number</p>
                    <div className="a-row">
                      <strong style={{ fontSize: 18, letterSpacing: "0.02em" }}>{tracking}</strong>
                      <CopyButton text={tracking} />
                    </div>
                  </div>
                  <p>
                    <span className="a-muted">TCS says: </span>
                    <strong>{order.courierStatus ?? "Booked"}</strong>
                    {order.courierStatus && <small className="a-muted"> ({customerFacingCourierStatus(order.courierStatus)})</small>}
                    {order.courierSyncedAt && <small className="a-muted" style={{ display: "block" }}>Checked {when(order.courierSyncedAt)}</small>}
                  </p>
                  <div className="a-row">
                    {connected && <ApiButton url={`/api/admin/orders/${id}/courier`} body={{ action: "sync" }} label="Check TCS now" busyLabel="Checking…" size="sm" icon="refund" success="Updated from TCS." />}
                    {connected && (
                      <a className="a-btn a-btn-sm" href={`/api/admin/orders/${id}/label`} target="_blank" rel="noopener noreferrer">
                        <Icon name="print" size={15} /> TCS label
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <p className="a-muted">{["confirmed", "processing", "packed"].includes(order.orderStatus) ? "Not booked yet. Use the green box on the left." : "No parcel has been booked for this order."}</p>
              )}
              {order.courierAutoError && !tracking && <Note tone="warn">{order.courierAutoError}</Note>}
            </div>
          </section>

          {refund && (
            <section className="a-card">
              <header className="a-card-head">
                <h2>Refund</h2>
                <RefundStatusBadge status={refund.status} />
              </header>
              <div className="a-card-pad a-stack" style={{ gap: 10 }}>
                <p>
                  {pkr(refund.amount)} · asked {when(refund.createdAt)}
                </p>
                <Link className="a-btn a-btn-primary" href={`/admin/refunds?open=${refund.id}`}>
                  Open refund request
                </Link>
              </div>
            </section>
          )}

          <section className="a-card">
            <header className="a-card-head">
              <h2>
                Your private note
              </h2>
            </header>
            <div className="a-card-pad">
              <PrivateNote orderId={id} initial={order.notes ?? ""} />
            </div>
          </section>

          <section className="a-card">
            <header className="a-card-head">
              <h2>Cancel</h2>
            </header>
            <div className="a-card-pad a-stack" style={{ gap: 12 }}>
              {blocked ? (
                <p className="a-muted">{blocked}</p>
              ) : (
                <>
                  <p className="a-muted">You can cancel until TCS collects the parcel. After that it is not possible.</p>
                  <div>
                    <CancelOrderButton orderId={id} orderNumber={order.orderNumber} hasTracking={Boolean(tracking)} paid={order.paymentStatus === "paid"} />
                  </div>
                </>
              )}
              {order.orderStatus === "delivered" && !refund && <p className="a-help">If the customer wants their money back, they can ask from the “Track your order” page, and it will appear in Refunds.</p>}
            </div>
          </section>
        </aside>
      </div>
      <p className="a-faint" style={{ marginTop: 18 }}>{info?.help}</p>
    </>
  );
}
