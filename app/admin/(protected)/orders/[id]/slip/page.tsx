import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { codAmountFor } from "@/lib/courier";
import { fullDate, pkr } from "../../../../_ui/ui";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packing slip" };

/** A simple slip to print and put inside the parcel: what is in it, who it is for, how much cash to collect. */
export default async function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) notFound();
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  const cod = codAmountFor(order);

  return (
    <>
      <div className="a-row a-no-print" style={{ marginBottom: 16 }}>
        <PrintButton />
        <span className="a-muted">Print on A5 or A4 paper and put it inside the parcel.</span>
      </div>
      <article className="a-card a-card-pad" style={{ maxWidth: 720, background: "#fff", color: "#111" }}>
        <header className="a-row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 26 }}>{BRAND.name}</h1>
            <p style={{ color: "#555" }}>{BRAND.tagline}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <strong style={{ fontSize: 20 }}>{order.orderNumber}</strong>
            <p style={{ color: "#555" }}>{fullDate(order.createdAt)}</p>
            {order.courierTrackingNumber && order.courierTrackingNumber !== "PENDING" && <p>TCS: {order.courierTrackingNumber}</p>}
          </div>
        </header>
        <section style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 14, color: "#555", marginBottom: 4 }}>DELIVER TO</h2>
          <p style={{ fontSize: 18, fontWeight: 650 }}>{order.customerName}</p>
          <p>{order.customerPhone}</p>
          <p>
            {order.address}, {order.city}, {order.province}
          </p>
          {order.deliveryNotes && <p style={{ marginTop: 4 }}>Note: {order.deliveryNotes}</p>}
        </section>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #111", textAlign: "left" }}>
              <th style={{ padding: "6px 0" }}>Item</th>
              <th>Code</th>
              <th style={{ textAlign: "right" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Price</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid #ddd" }}>
                <td style={{ padding: "8px 0" }}>
                  <strong>{item.productName}</strong>
                  <br />
                  <span style={{ color: "#555" }}>{item.variantName}</span>
                </td>
                <td>{item.sku}</td>
                <td style={{ textAlign: "right" }}>{item.quantity}</td>
                <td style={{ textAlign: "right" }}>{pkr(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "right", display: "grid", gap: 3 }}>
          <span>Items {pkr(order.subtotal)}</span>
          <span>Delivery {order.deliveryCharge ? pkr(order.deliveryCharge) : "Free"}</span>
          {order.discount > 0 && <span>Discount − {pkr(order.discount)}</span>}
          <strong style={{ fontSize: 18 }}>Total {pkr(order.total)}</strong>
          <strong style={{ fontSize: 20, border: "2px solid #111", display: "inline-block", marginLeft: "auto", padding: "6px 12px" }}>{cod > 0 ? `Cash to collect: ${pkr(cod)}` : "PAID — nothing to collect"}</strong>
        </div>
        <footer style={{ marginTop: 22, color: "#555", fontSize: 13.5 }}>
          Thank you for shopping with {BRAND.name}. Questions? WhatsApp {BRAND.contact.whatsappPhone}. Changed your mind or something is wrong? Contact us within 7 days of delivery.
        </footer>
      </article>
    </>
  );
}
