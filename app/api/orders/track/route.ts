import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { lookupBlocked, noteLookupMiss, requestIp } from "@/lib/auth/rate-limit";
import { orderItems, orderStatusHistory, orders } from "@/db/schema";
import { cleanPhone } from "@/lib/slug";
import { toWhatsAppPhone } from "@/lib/whatsapp";
import { customerFacingCourierStatus, cancelBlockReason } from "@/lib/order-rules";
import { checkRefundEligibility, getRefundForOrder } from "@/lib/refunds";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { orderNumber?: string; phone?: string };
  try {
    body = (await request.json()) as { orderNumber?: string; phone?: string };
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const orderNumber = String(body.orderNumber ?? "").trim().toUpperCase();
  const phone = cleanPhone(String(body.phone ?? ""));
  if (!orderNumber || phone.replace(/\D/g, "").length < 4) {
    return Response.json({ error: "Enter the order number and phone." }, { status: 400 });
  }

  const ip = requestIp(request);
  if (await lookupBlocked("order-lookup", ip)) return Response.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });

  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      city: orders.city,
      province: orders.province,
      subtotal: orders.subtotal,
      deliveryCharge: orders.deliveryCharge,
      total: orders.total,
      paymentMethod: orders.paymentMethod,
      paymentStatus: orders.paymentStatus,
      orderStatus: orders.orderStatus,
      reservationExpiresAt: orders.reservationExpiresAt,
      courierName: orders.courierName,
      courierTrackingNumber: orders.courierTrackingNumber,
      courierStatus: orders.courierStatus,
      handedOverAt: orders.handedOverAt,
      cancelReason: orders.cancelReason,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  // Don't leak whether the order number exists to a phone number that doesn't match it: always
  // return the same 404 whether the order is missing or the phone simply doesn't match.
  //
  // Compared via toWhatsAppPhone's canonical digits-only form rather than raw string equality —
  // checkout accepts free-text phone entry ("0300...", "+92300...", "92300..."), and a customer
  // isn't guaranteed to type it the same way twice. A raw-string match would silently fail to find
  // a real order any time the two entries used different (but equivalent) formats.
  if (!order || toWhatsAppPhone(order.customerPhone) !== toWhatsAppPhone(phone)) {
    await noteLookupMiss("order-lookup", ip);
    return Response.json({ error: "No matching order was found." }, { status: 404 });
  }

  const [items, history] = await Promise.all([
    db
      .select({
        productName: orderItems.productName,
        variantName: orderItems.variantName,
        sku: orderItems.sku,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id)),
    db
      .select({
        status: orderStatusHistory.toStatus,
        fromStatus: orderStatusHistory.fromStatus,
        note: orderStatusHistory.note,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id))
      .orderBy(desc(orderStatusHistory.createdAt)),
  ]);

  // Courier details come from what our own sync last stored — the customer's request never reaches
  // TCS, and the account details never leaves the server. "PENDING" is the in-flight booking marker, not a
  // real tracking number, so it's never shown.
  const hasCourier = Boolean(order.courierTrackingNumber) && order.courierTrackingNumber !== "PENDING";
  const [refund, refundCheck] = await Promise.all([getRefundForOrder(order.id), checkRefundEligibility({ id: order.id, orderStatus: order.orderStatus })]);
  const cancelBlock = cancelBlockReason(order, "customer");

  return Response.json({
    courier: hasCourier
      ? {
          name: order.courierName,
          trackingNumber: order.courierTrackingNumber,
          status: customerFacingCourierStatus(order.courierStatus),
        }
      : null,
    // What the shopper may do next: cancel (only until TCS has the parcel) or ask for a refund.
    actions: {
      canCancel: cancelBlock === null,
      cancelBlockedReason: cancelBlock,
      canRequestRefund: refundCheck.ok,
      refundBlockedReason: refundCheck.ok ? null : refundCheck.reason,
    },
    refund: refund
      ? {
          status: refund.status,
          amount: refund.amount,
          reason: refund.reason,
          needsPayoutDetails: refund.status === "requested" && !refund.payoutAccount,
          adminNote: refund.status === "rejected" || refund.status === "approved" ? refund.adminNote : null,
          refundedAt: refund.refundedAt ? refund.refundedAt.toISOString() : null,
          reference: refund.status === "refunded" ? refund.refundReference : null,
        }
      : null,
    order: {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      city: order.city,
      province: order.province,
      subtotal: order.subtotal,
      deliveryCharge: order.deliveryCharge,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      reservationExpiresAt: order.reservationExpiresAt ? order.reservationExpiresAt.toISOString() : null,
      createdAt: order.createdAt.toISOString(),
    },
    items,
    // A row whose status didn't actually change (from === to) is an internal annotation — e.g. a
    // courier booking, or "automatic booking failed, book manually" — not something to show a
    // customer. Their courier details live in the `courier` block above instead.
    history: history
      .filter((entry) => entry.fromStatus !== entry.status)
      .map(({ status, note, createdAt }) => ({ status, note, createdAt: createdAt.toISOString() })),
  });
}
