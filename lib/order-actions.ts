// The one way an order gets cancelled – used by the admin screen, the customer's "Cancel my order" button,
// the WhatsApp Cancel button and the reservation-expiry job – so the rule "cancellable only until TCS has
// the parcel" is enforced in exactly one place, atomically.

import { autoBookOnConfirm, type CourierNotice } from "@/lib/courier";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orderStatusHistory, orders } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { releaseCourierBooking } from "@/lib/courier";
import { announceOrderEvent, type OrderEventKind } from "@/lib/order-events";
import { CANCELLABLE_STATUSES, cancelBlockReason, cancelReasonLabel, statusLabel } from "@/lib/order-rules";
import { fulfillOrderReservation, releaseOrderReservation, restockReturnedOrder } from "@/lib/orders";
import { createRefundIfPrepaid } from "@/lib/refunds";

export type CancelActor = { kind: "admin"; email: string } | { kind: "customer" } | { kind: "system" };

export type CancelResult =
  | { ok: true; courierWarning?: string; refundOpened: boolean }
  | { ok: false; status: 404 | 409; error: string };

export async function cancelOrder(orderId: string, actor: CancelActor, reason: string, note?: string): Promise<CancelResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, status: 404, error: "Order not found." };

  const blocked = cancelBlockReason(order, actor.kind === "customer" ? "customer" : "admin");
  if (blocked) return { ok: false, status: 409, error: blocked };

  const actorLabel = actor.kind === "admin" ? actor.email : actor.kind;
  const now = new Date();
  // Guarded on "TCS has not taken it": if the courier sync marks the parcel collected at this very moment,
  // exactly one of the two wins and the loser is told why.
  const [row] = await db
    .update(orders)
    .set({ orderStatus: "cancelled", updatedAt: now, cancelledAt: now, cancelReason: reason, cancelledBy: actorLabel })
    .where(and(eq(orders.id, orderId), inArray(orders.orderStatus, [...CANCELLABLE_STATUSES]), isNull(orders.handedOverAt)))
    .returning();
  if (!row) {
    const [fresh] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    return { ok: false, status: 409, error: (fresh && cancelBlockReason(fresh, actor.kind === "customer" ? "customer" : "admin")) || "This order was just changed – please refresh and try again." };
  }

  await db.insert(orderStatusHistory).values({
    orderId,
    fromStatus: order.orderStatus,
    toStatus: "cancelled",
    note: [cancelReasonLabel(reason), note].filter(Boolean).join(" — ") || null,
    actorEmail: actorLabel,
  });
  await releaseOrderReservation(orderId, actor.kind === "customer" ? "Order cancelled by the customer" : actor.kind === "admin" ? "Order cancelled by admin" : "Order cancelled automatically", actorLabel, now);
  const courier = await releaseCourierBooking(row, actorLabel);
  const refund = await createRefundIfPrepaid(orderId, "cancelled");
  announceOrderEvent(orderId, "cancelled", actor.kind === "admin" ? "admin" : actor.kind);
  await auditLogEntry({ actorEmail: actorLabel, action: "order.cancel", entityType: "order", entityId: orderId, detail: { from: order.orderStatus, reason, note, courierCancelled: courier.cancelled } });
  return { ok: true, courierWarning: courier.warning, refundOpened: Boolean(refund) };
}

export type MoveTarget = "confirmed" | "processing" | "packed" | "shipped" | "delivered" | "returned";

const FORWARD: Record<string, string[]> = {
  pending_confirmation: ["confirmed"],
  confirmed: ["processing", "packed", "shipped"],
  processing: ["packed", "shipped"],
  packed: ["shipped"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

export type MoveResult = { ok: true; order: typeof orders.$inferSelect; courierNotice?: CourierNotice | null } | { ok: false; status: 400 | 404 | 409; error: string };

/** Moves an order one step forward (confirm → pack → with TCS → delivered/returned) and does the stock,
 * payment and notification side effects exactly once, even if clicked twice. */
export async function moveOrder(orderId: string, toStatus: MoveTarget, adminEmail: string, note?: string): Promise<MoveResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, status: 404, error: "Order not found." };
  if (!(FORWARD[order.orderStatus] ?? []).includes(toStatus)) {
    return { ok: false, status: 400, error: `This order is "${statusLabel(order.orderStatus)}", so it can't be moved to "${statusLabel(toStatus)}".` };
  }

  // Guarded on the status we just read: a double-click (or two admins) racing the same transition would
  // otherwise run the stock side effects below twice. The loser gets a 409 and does nothing.
  const now = new Date();
  const [row] = await db
    .update(orders)
    .set({
      orderStatus: toStatus,
      updatedAt: now,
      // Once the owner says TCS has the parcel it can no longer be cancelled.
      ...(toStatus === "shipped" && !order.handedOverAt ? { handedOverAt: now } : {}),
      ...(toStatus === "delivered" && order.paymentStatus === "pending" ? { paymentStatus: "paid" } : {}),
    })
    .where(and(eq(orders.id, orderId), eq(orders.orderStatus, order.orderStatus)))
    .returning();
  if (!row) return { ok: false, status: 409, error: "Someone else just changed this order — please refresh and try again." };

  await db.insert(orderStatusHistory).values({ orderId, fromStatus: order.orderStatus, toStatus, note: note || null, actorEmail: adminEmail });

  // "delivered" is the one point where a reservation becomes a real, permanent stock reduction – see
  // fulfillOrderReservation. A return after "delivered" puts physical stock back on the shelf; a return
  // straight from "shipped" (refused at the door) only releases the reservation.
  if (toStatus === "delivered") await fulfillOrderReservation(orderId, adminEmail);
  else if (toStatus === "returned") {
    if (order.orderStatus === "delivered") await restockReturnedOrder(orderId, adminEmail);
    else await releaseOrderReservation(orderId, "Order returned", adminEmail);
    await createRefundIfPrepaid(orderId, "returned");
  }

  const announced: Partial<Record<string, OrderEventKind>> = { confirmed: "confirmed", shipped: "shipped", delivered: "delivered", returned: "returned" };
  const kind = announced[toStatus];
  if (kind) announceOrderEvent(orderId, kind, "admin");

  await auditLogEntry({ actorEmail: adminEmail, action: "order.status", entityType: "order", entityId: orderId, detail: { from: order.orderStatus, to: toStatus, note } });
  const courierNotice = toStatus === "confirmed" ? await autoBookOnConfirm(orderId, adminEmail) : null;
  return { ok: true, order: row, courierNotice };
}
