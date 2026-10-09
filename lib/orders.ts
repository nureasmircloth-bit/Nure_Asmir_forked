import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryMovements, orderItems, orderStatusHistory, orders, productVariants } from "@/db/schema";
import { sendReservationReminderEmail } from "@/lib/email/resend";
import { getPublicSettings } from "@/lib/commerce";
import { checkStockAlerts } from "@/lib/stock-alerts";
import { announceOrderEvent } from "@/lib/order-events";

const REMINDER_WINDOW_HOURS = 3;

/**
 * Cancels orders whose stock reservation has expired while still awaiting confirmation, releasing
 * the reserved stock back to the pool. Intended to run before every checkout attempt and from a
 * scheduled cron trigger (see app/api/cron/expire-reservations/route.ts).
 *
 * This project's Neon connection (db/index.ts) uses the stateless `neon-http` driver — a
 * connection-pooling driver caused real production failures on Cloudflare Workers ("Cannot
 * perform I/O on behalf of a different request"), because Workers forbids reusing a persistent
 * connection across different requests. `neon-http` has no `db.transaction()`, so each order here
 * is processed with plain sequential awaits instead, guarded by a conditional UPDATE (cancel only
 * if still "pending_confirmation") so two concurrent runs can never double-cancel or
 * double-release the same order.
 */
export async function expireReservations(): Promise<void> {
  const now = new Date();
  const expired = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(lt(orders.reservationExpiresAt, now), eq(orders.orderStatus, "pending_confirmation")))
    .limit(50);

  for (const order of expired) {
    const cancelled = await db
      .update(orders)
      .set({ orderStatus: "cancelled", updatedAt: now, cancelledAt: now, cancelReason: "expired", cancelledBy: "system" })
      .where(and(eq(orders.id, order.id), eq(orders.orderStatus, "pending_confirmation")))
      .returning({ id: orders.id });
    if (cancelled.length === 0) continue; // a concurrent run already handled this order

    await db.insert(orderStatusHistory).values({
      orderId: order.id,
      fromStatus: "pending_confirmation",
      toStatus: "cancelled",
      note: "Reservation expired automatically",
      actorEmail: "system",
    });

    await releaseOrderReservation(order.id, "Reservation expired", "system", now);
    announceOrderEvent(order.id, "cancelled", "system");
  }
}

/**
 * Releases the reserved stock a single order is holding, e.g. after it's manually cancelled or
 * returned by an admin (see app/api/admin/orders/[id]/status/route.ts) — mirrors the release loop
 * expireReservations() runs for auto-cancelled orders. `greatest(0, ...)` guards against this
 * running twice for the same order (e.g. a cancel racing the expiry cron) ever driving the count
 * negative.
 */
export async function releaseOrderReservation(
  orderId: string,
  reason: string,
  actorEmail: string,
  now: Date = new Date(),
): Promise<void> {
  const items = await db
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const item of items) {
    if (!item.variantId) continue;
    await db
      .update(productVariants)
      .set({
        reservedQuantity: sql`greatest(0, ${productVariants.reservedQuantity} - ${item.quantity})`,
        updatedAt: now,
      })
      .where(eq(productVariants.id, item.variantId));

    await db.insert(inventoryMovements).values({
      variantId: item.variantId,
      type: "release",
      quantity: -item.quantity,
      reason,
      referenceType: "order",
      referenceId: orderId,
      actorEmail,
    });
  }
  await checkStockAlerts(items.flatMap((item) => (item.variantId ? [item.variantId] : [])));
}

/**
 * Converts a reservation into a permanent sale when an order is marked delivered — the only point
 * in the order lifecycle where a unit actually leaves stock. Before this, reservedQuantity was the
 * *only* thing that ever moved; stockQuantity itself was never touched by the order flow, so a unit
 * delivered weeks ago looked identical, in the data, to one still held by an order in transit.
 * Decrements both counters together so the reservation clears and the shelf count drops as one step
 * (both floored at 0 so this can never run negative if it somehow fires twice for the same order).
 */
export async function fulfillOrderReservation(orderId: string, actorEmail: string, now: Date = new Date()): Promise<void> {
  const items = await db
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const item of items) {
    if (!item.variantId) continue;
    await db
      .update(productVariants)
      .set({
        stockQuantity: sql`greatest(0, ${productVariants.stockQuantity} - ${item.quantity})`,
        reservedQuantity: sql`greatest(0, ${productVariants.reservedQuantity} - ${item.quantity})`,
        updatedAt: now,
      })
      .where(eq(productVariants.id, item.variantId));

    await db.insert(inventoryMovements).values({
      variantId: item.variantId,
      type: "sale",
      quantity: -item.quantity,
      reason: "Order delivered",
      referenceType: "order",
      referenceId: orderId,
      actorEmail,
    });
  }
  await checkStockAlerts(items.flatMap((item) => (item.variantId ? [item.variantId] : [])));
}

/**
 * Adds stock back after an order that already reached "delivered" is later returned — by that
 * point the units were already permanently removed by fulfillOrderReservation, so a return means
 * physical stock is back on the shelf, not just that a reservation can be released. Returns for an
 * order that never made it past "shipped" go through releaseOrderReservation instead (see the
 * admin status route), since nothing was ever permanently decremented for those.
 */
export async function restockReturnedOrder(orderId: string, actorEmail: string, now: Date = new Date()): Promise<void> {
  const items = await db
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const item of items) {
    if (!item.variantId) continue;
    await db
      .update(productVariants)
      .set({
        stockQuantity: sql`${productVariants.stockQuantity} + ${item.quantity}`,
        updatedAt: now,
      })
      .where(eq(productVariants.id, item.variantId));

    await db.insert(inventoryMovements).values({
      variantId: item.variantId,
      type: "restock",
      quantity: item.quantity,
      reason: "Order returned after delivery",
      referenceType: "order",
      referenceId: orderId,
      actorEmail,
    });
  }
  await checkStockAlerts(items.flatMap((item) => (item.variantId ? [item.variantId] : [])));
}

/**
 * Emails a "your order is waiting" nudge for orders still pending_confirmation whose reservation
 * expires within REMINDER_WINDOW_HOURS — the closest fit to a classic "abandoned cart" reminder
 * that this store's data model actually supports: since the cart itself is only ever kept in the
 * customer's browser (see lib/cart.ts) and no email is captured until checkout is submitted, there
 * is nothing to remind before an order exists. Once an order exists we do know their email, and a
 * COD/bank-deposit order sitting unconfirmed near its reservation deadline is the equivalent
 * moment of risk — a nudge here can recover an order that would otherwise auto-cancel.
 *
 * Guarded by reminderSentAt so a run every 15 minutes never emails the same order twice, using the
 * same sequential-writes pattern as expireReservations (see its comment for why).
 */
export async function sendReservationReminders(): Promise<void> {
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);

  const candidates = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      total: orders.total,
      currency: orders.currency,
      paymentMethod: orders.paymentMethod,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orderStatus, "pending_confirmation"),
        isNull(orders.reminderSentAt),
        gt(orders.reservationExpiresAt, now),
        lt(orders.reservationExpiresAt, reminderCutoff),
      ),
    )
    .limit(50);

  if (!candidates.length) return;

  const settings = await getPublicSettings();

  for (const order of candidates) {
    if (!order.customerEmail) continue;

    const claimed = await db
      .update(orders)
      .set({ reminderSentAt: now })
      .where(and(eq(orders.id, order.id), isNull(orders.reminderSentAt)))
      .returning({ id: orders.id });
    if (claimed.length === 0) continue; // a concurrent run already claimed this order

    await sendReservationReminderEmail({
      toEmail: order.customerEmail,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      total: order.total,
      currency: order.currency,
      paymentMethod: order.paymentMethod as "cod" | "bank_deposit",
      whatsappNumber: settings.whatsappNumber || undefined,
    });
  }
}

/**
 * Repairs reserved-stock drift. `reservedQuantity` is bumped before the order row is written (see
 * app/api/orders/route.ts), so a Worker killed in between would leak a reservation that no order
 * owns. This recomputes what the open orders (pending → shipped) actually hold and corrects any
 * variant that disagrees and has been idle for 10 minutes (so an order mid-creation is never
 * "corrected" underneath itself). Safe to run repeatedly.
 */
export async function reconcileReservedStock(): Promise<{ repaired: number }> {
  const idleBefore = new Date(Date.now() - 10 * 60 * 1000);
  const result = await db.execute(sql`
    UPDATE product_variants v
    SET reserved_quantity = x.expected, updated_at = now()
    FROM (
      SELECT pv.id, coalesce(held.quantity, 0)::int AS expected
      FROM product_variants pv
      LEFT JOIN (
        SELECT oi.variant_id, sum(oi.quantity) AS quantity
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.order_status IN ('pending_confirmation','confirmed','processing','packed','shipped')
        GROUP BY oi.variant_id
      ) held ON held.variant_id = pv.id
    ) x
    WHERE v.id = x.id AND v.reserved_quantity <> x.expected AND v.updated_at < ${idleBefore}
    RETURNING v.id
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  if (rows.length) console.warn(`reconcileReservedStock repaired ${rows.length} variant(s)`);
  return { repaired: rows.length };
}
