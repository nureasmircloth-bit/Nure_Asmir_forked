// TCS booking + status sync, shared by the admin order screens and the scheduled job
// (app/api/cron/courier-sync). One place decides how an order is booked and what a courier status means,
// so a button click and the automation can never disagree.

import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orderStatusHistory, orders, siteSettings } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { announceOrderEvent } from "@/lib/order-events";
import { courierStage } from "@/lib/order-rules";
import { fulfillOrderReservation, releaseOrderReservation } from "@/lib/orders";
import { createRefundIfPrepaid } from "@/lib/refunds";
import {
  TcsError,
  bookTcsParcel,
  cancelTcsParcel,
  isRetryableTcsError,
  isTcsConfigured,
  toPkMobile,
  trackTcsParcel,
  type TcsShipper,
} from "@/lib/tcs";

type OrderRow = typeof orders.$inferSelect;

export const BOOKABLE_STATUSES = ["confirmed", "processing", "packed"];
const PENDING = "PENDING";
const STALE_CLAIM_MS = 2 * 60 * 1000;
const SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
const SYNC_BATCH = 30;

export type BookOverrides = {
  customerPhone?: string;
  cityName?: string;
  address?: string;
  codAmount?: number;
  pieces?: number;
  weightKg?: number;
  fragile?: boolean;
  remarks?: string;
};

export type BookResult =
  | { ok: true; trackingNumber: string }
  | { ok: false; kind: "not_found" | "not_bookable" | "invalid" | "conflict" | "tcs" | "not_configured"; message: string; retryable: boolean };

const fail = (kind: Extract<BookResult, { ok: false }>["kind"], message: string, retryable = false): BookResult => ({ ok: false, kind, message, retryable });

export async function getShipper(): Promise<TcsShipper> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  return {
    name: row?.tcsShipperName || "Nure Asmir",
    address: row?.tcsShipperAddress || "",
    cityName: row?.tcsShipperCityName || "Karachi",
    cityCode: row?.tcsShipperCityCode || "KHI",
    phone: row?.tcsShipperPhone || row?.supportPhone || "",
  };
}

/** Each piece weighs about half a kilo for TCS's purposes; TCS's own minimum is 0.5 kg. */
export function defaultWeightKg(pieces: number): number {
  return Math.max(0.5, Math.round(pieces * 0.5 * 2) / 2);
}

/** The cash the rider must collect: everything for cash on delivery, nothing once a bank payment was approved. */
export function codAmountFor(order: Pick<OrderRow, "paymentStatus" | "total">): number {
  return order.paymentStatus === "paid" ? 0 : order.total;
}

function tcsFailure(error: unknown): BookResult {
  if (error instanceof TcsError) return fail("tcs", error.message, isRetryableTcsError(error));
  console.error("TCS call failed", error);
  return fail("tcs", "Something went wrong talking to TCS.", true);
}

/**
 * Books one order with TCS and stores the consignment (CN) number. Everything that can be validated
 * without side effects is checked first, so a rejected request never leaves an order half-booked. The
 * order is claimed before TCS is called, so two clicks (or two admins) can never create two parcels.
 */
export async function bookOrderWithTcs(orderId: string, actorEmail: string, overrides: BookOverrides = {}): Promise<BookResult> {
  if (!isTcsConfigured()) return fail("not_configured", "TCS is not connected yet. Add the TCS details in Settings, or book on the TCS website and save the tracking number here.");
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return fail("not_found", "Order not found.");
  if (!BOOKABLE_STATUSES.includes(order.orderStatus)) {
    return fail("not_bookable", `A "${order.orderStatus.replaceAll("_", " ")}" order can't be booked with TCS. Confirm it first.`);
  }
  if (order.courierTrackingNumber && order.courierTrackingNumber !== PENDING) return fail("conflict", "This order already has a TCS tracking number.");

  const phone = toPkMobile(overrides.customerPhone || order.customerPhone);
  if (!phone) return fail("invalid", "TCS needs a valid mobile number like 03001234567. Please correct the customer's phone number.");
  const cityName = (overrides.cityName || order.city).trim();
  if (cityName.length < 3) return fail("invalid", "Please enter the customer's city.");
  const address = (overrides.address || order.address).trim();
  if (address.length < 3) return fail("invalid", "Please enter the customer's address.");

  const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const pieces = overrides.pieces ?? (lines.reduce((sum, line) => sum + line.quantity, 0) || 1);
  const codAmount = overrides.codAmount ?? codAmountFor(order);
  if (codAmount > 250_000) return fail("invalid", "TCS cannot collect more than PKR 250,000 on one parcel. Split the order or ask for a bank transfer.");

  const now = new Date();
  const claimed = await db
    .update(orders)
    .set({ courierTrackingNumber: PENDING, courierBookedAt: now })
    .where(
      and(
        eq(orders.id, orderId),
        or(isNull(orders.courierTrackingNumber), and(eq(orders.courierTrackingNumber, PENDING), lt(orders.courierBookedAt, new Date(now.getTime() - STALE_CLAIM_MS)))),
      ),
    )
    .returning({ id: orders.id });
  if (claimed.length === 0) return fail("conflict", "This order is already being booked, or already booked.");

  let trackingNumber: string;
  try {
    ({ consignmentNo: trackingNumber } = await bookTcsParcel({
      shipper: await getShipper(),
      referenceNo: order.orderNumber,
      consignee: { name: order.customerName, phone, email: order.customerEmail, address, cityName, landmark: order.deliveryNotes },
      codAmount,
      pieces,
      weightKg: overrides.weightKg ?? defaultWeightKg(pieces),
      fragile: overrides.fragile,
      remarks: overrides.remarks ?? [`Order ${order.orderNumber}`, order.notes, order.deliveryNotes].filter(Boolean).join(" — "),
      items: lines.map((line) => ({ productName: line.productName, variantName: line.variantName, quantity: line.quantity, unitPrice: line.unitPrice })),
    }));
  } catch (error) {
    await db.update(orders).set({ courierTrackingNumber: null, courierBookedAt: null }).where(and(eq(orders.id, orderId), eq(orders.courierTrackingNumber, PENDING)));
    return tcsFailure(error);
  }

  await db
    .update(orders)
    .set({ courierName: "TCS", courierTrackingNumber: trackingNumber, courierBookedAt: new Date(), courierStatus: "Booked", courierSyncedAt: new Date(), courierAutoError: null })
    .where(eq(orders.id, orderId));
  await db.insert(orderStatusHistory).values({
    orderId,
    fromStatus: order.orderStatus,
    toStatus: order.orderStatus,
    note: `Booked with TCS — tracking ${trackingNumber} (rider collects PKR ${codAmount.toLocaleString("en-PK")})`,
    actorEmail,
  });
  await auditLogEntry({ actorEmail, action: "order.tcs_book", entityType: "order", entityId: orderId, detail: { trackingNumber, cityName, codAmount } });
  announceOrderEvent(orderId, "booked", "admin");
  return { ok: true, trackingNumber };
}

/** The owner booked the parcel on the TCS website (or by phone) and types the tracking number in here. */
export async function saveManualTracking(orderId: string, trackingNumber: string, actorEmail: string): Promise<BookResult> {
  const cn = trackingNumber.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9-]{6,24}$/.test(cn)) return fail("invalid", "That doesn't look like a TCS tracking number. It is usually 10–14 digits.");
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return fail("not_found", "Order not found.");
  if (!BOOKABLE_STATUSES.includes(order.orderStatus)) return fail("not_bookable", "Confirm the order first, then add the tracking number.");
  const [saved] = await db
    .update(orders)
    .set({ courierName: "TCS", courierTrackingNumber: cn, courierBookedAt: new Date(), courierStatus: "Booked", courierSyncedAt: null, courierAutoError: null })
    .where(and(eq(orders.id, orderId), inArray(orders.orderStatus, BOOKABLE_STATUSES), or(isNull(orders.courierTrackingNumber), ne(orders.courierTrackingNumber, PENDING))))
    .returning({ id: orders.id });
  if (!saved) return fail("conflict", "This order changed just now – refresh and try again.");
  await db.insert(orderStatusHistory).values({ orderId, fromStatus: order.orderStatus, toStatus: order.orderStatus, note: `TCS tracking number added by hand: ${cn}`, actorEmail });
  await auditLogEntry({ actorEmail, action: "order.tcs_manual", entityType: "order", entityId: orderId, detail: { trackingNumber: cn } });
  announceOrderEvent(orderId, "booked", "admin");
  return { ok: true, trackingNumber: cn };
}

/**
 * Tells TCS to forget a booking that has not been collected yet and clears it from the order. Never throws:
 * `cancelled` says whether TCS confirmed; when it did not (TCS website booking, TCS down), the order is
 * still freed and the caller shows `warning` so the owner can also cancel it on the TCS website.
 */
export async function releaseCourierBooking(order: Pick<OrderRow, "id" | "orderNumber" | "courierTrackingNumber">, actorEmail: string): Promise<{ had: boolean; cancelled: boolean; warning?: string }> {
  const cn = order.courierTrackingNumber;
  if (!cn || cn === PENDING) return { had: false, cancelled: false };
  let cancelled = false;
  let warning: string | undefined;
  if (isTcsConfigured()) {
    try {
      await cancelTcsParcel(cn);
      cancelled = true;
    } catch (error) {
      warning = `TCS did not confirm the cancellation of ${cn} (${error instanceof Error ? error.message : "unknown error"}). Please also cancel it on the TCS website.`;
    }
  } else {
    warning = `Tracking number ${cn} was added by hand, so please also cancel it on the TCS website.`;
  }
  await db.update(orders).set({ courierTrackingNumber: null, courierBookedAt: null, courierStatus: null, courierSyncedAt: null, courierAutoAttempts: 3 }).where(eq(orders.id, order.id));
  await db.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: "cancelled",
    note: cancelled ? `TCS booking ${cn} cancelled` : `TCS booking ${cn} removed from this order`,
    actorEmail,
  });
  return { had: true, cancelled, warning };
}

/** Moves an order forward because TCS (or the owner, pressing "TCS has collected it") says so. Forward-only
 * and guarded on the status we read, so it can never undo or race another change. */
export async function applyCourierTransition(order: OrderRow, target: "shipped" | "delivered" | "returned", note: string, actor: string): Promise<boolean> {
  const allowedFrom = target === "shipped" ? ["confirmed", "processing", "packed"] : ["confirmed", "processing", "packed", "shipped"];
  if (!allowedFrom.includes(order.orderStatus)) return false;

  const now = new Date();
  const [moved] = await db
    .update(orders)
    .set({
      orderStatus: target,
      updatedAt: now,
      ...(target === "shipped" || !order.handedOverAt ? { handedOverAt: order.handedOverAt ?? now } : {}),
      // Cash on delivery is paid at the door.
      ...(target === "delivered" && order.paymentStatus === "pending" ? { paymentStatus: "paid" } : {}),
    })
    .where(and(eq(orders.id, order.id), eq(orders.orderStatus, order.orderStatus)))
    .returning({ id: orders.id });
  if (!moved) return false;

  await db.insert(orderStatusHistory).values({ orderId: order.id, fromStatus: order.orderStatus, toStatus: target, note, actorEmail: actor });
  if (target === "delivered") await fulfillOrderReservation(order.id, actor);
  else if (target === "returned") {
    await releaseOrderReservation(order.id, "Order returned by courier (TCS)", actor);
    await createRefundIfPrepaid(order.id, "returned");
  }
  announceOrderEvent(order.id, target, actor === "system" ? "system" : "admin");
  await auditLogEntry({ actorEmail: actor, action: "order.courier_move", entityType: "order", entityId: order.id, detail: { from: order.orderStatus, to: target, note } });
  return true;
}

export type SyncSummary = { checked: number; updated: number; moved: number; failed: number };

/**
 * Refreshes each booked parcel's status from TCS and, where it means something for the order (TCS has it /
 * delivered / returned), advances the order. Per-order throttled unless `force` or an `orderId` is given, so
 * the 5-minute job stays cheap and a manual click always gets a fresh answer.
 */
export async function syncCourierStatuses(options: { orderId?: string; force?: boolean } = {}): Promise<SyncSummary> {
  const summary: SyncSummary = { checked: 0, updated: 0, moved: 0, failed: 0 };
  if (!isTcsConfigured()) return summary;
  const staleBefore = new Date(Date.now() - SYNC_MIN_INTERVAL_MS);
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.orderStatus, ["confirmed", "processing", "packed", "shipped"]),
        ne(orders.courierTrackingNumber, PENDING),
        sql`${orders.courierTrackingNumber} is not null`,
        options.orderId ? eq(orders.id, options.orderId) : options.force ? undefined : or(isNull(orders.courierSyncedAt), lt(orders.courierSyncedAt, staleBefore)),
      ),
    )
    .orderBy(sql`${orders.courierSyncedAt} asc nulls first`)
    .limit(SYNC_BATCH);

  summary.checked = rows.length;
  for (const row of rows) {
    try {
      const tracking = await trackTcsParcel(row.courierTrackingNumber as string);
      const text = tracking.status ?? row.courierStatus ?? "Booked";
      await db.update(orders).set({ courierStatus: text, courierSyncedAt: new Date() }).where(eq(orders.id, row.id));
      summary.updated++;

      const stage = courierStage(tracking.status);
      const target = stage === "delivered" ? "delivered" : stage === "returned" ? "returned" : stage === "handed_over" || stage === "out_for_delivery" || stage === "failed_attempt" ? "shipped" : null;
      if (target && (await applyCourierTransition(row, target, `TCS: ${text}`, "system"))) summary.moved++;
    } catch (error) {
      summary.failed++;
      console.error("TCS sync failed for", row.orderNumber, error);
    }
  }
  return summary;
}
