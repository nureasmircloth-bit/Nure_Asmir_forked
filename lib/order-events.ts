import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerPushDevices, orderEventsSent, orders } from "@/db/schema";
import { siteOrigin } from "@/lib/brand";
import { runInBackground } from "@/lib/background";
import { sendOrderStatusEmail } from "@/lib/email/resend";
import { ORDER_EVENT_COPY, type OrderEventKind } from "@/lib/email/templates/order-status";
import { notifyAdmins, sendToCustomerTokens } from "@/lib/push/notify";

export type { OrderEventKind };

const ADMIN_LABEL: Partial<Record<OrderEventKind, string>> = {
  booked: "TCS booked",
  shipped: "TCS has the parcel",
  delivered: "Order delivered",
  cancelled: "Order cancelled",
  paid: "Payment verified",
  returned: "Order returned",
};

/**
 * Announces an order lifecycle event (confirmed / paid / on its way / delivered / cancelled / returned)
 * to the customer by push (devices that opted in for this order) and email, once per (order, event).
 * `actor` decides whether the owner is also pinged: changes made by the customer or the system
 * (WhatsApp cancel, reservation expiry) are news to the admin; their own clicks are not.
 *
 * Runs in the background and never throws, so it is safe to call from any status-changing route.
 */
export function announceOrderEvent(orderId: string, event: OrderEventKind, actor: "admin" | "customer" | "system" = "admin"): void {
  runInBackground(deliver(orderId, event, actor), `announceOrderEvent(${event})`);
}

async function deliver(orderId: string, event: OrderEventKind, actor: "admin" | "customer" | "system"): Promise<void> {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      trackingNumber: orders.courierTrackingNumber,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return;

  // Idempotency: only the first caller for this (order, event) proceeds.
  const claimed = await db.insert(orderEventsSent).values({ orderId, event }).onConflictDoNothing().returning({ event: orderEventsSent.event });
  if (!claimed.length) return;

  const copy = ORDER_EVENT_COPY[event];
  const tracking = order.trackingNumber && order.trackingNumber !== "PENDING" ? order.trackingNumber : null;
  const trackUrl = `${siteOrigin()}/track-order?order=${encodeURIComponent(order.orderNumber)}`;

  const devices = await db
    .select({ token: customerPushDevices.token })
    .from(customerPushDevices)
    .where(sql`${customerPushDevices.orderNumbers} @> ${JSON.stringify([order.orderNumber])}::jsonb`);

  await Promise.all([
    sendToCustomerTokens(
      devices.map((device) => device.token),
      { title: copy.title, body: copy.body(order.orderNumber, tracking), url: `/track-order?order=${encodeURIComponent(order.orderNumber)}`, tag: `order-${order.orderNumber}` },
    ),
    order.customerEmail
      ? sendOrderStatusEmail({ toEmail: order.customerEmail, event, orderNumber: order.orderNumber, customerName: order.customerName, trackingNumber: tracking, trackUrl })
      : Promise.resolve(),
  ]);

  const adminLabel = ADMIN_LABEL[event];
  // A booking is news to every admin device, even when a colleague made it; other changes only when the owner did not do them.
  if ((actor !== "admin" || event === "booked") && adminLabel) {
    notifyAdmins({
      title: adminLabel,
      body: (event === "booked" ? `${order.orderNumber} — tracking ${tracking ?? "pending"}` : `${order.orderNumber} — ${actor === "customer" ? "by the customer" : "automatically"}`).slice(0, 200),
      url: "/admin/orders",
      tag: `order-${order.orderNumber}`,
    });
  }
}
