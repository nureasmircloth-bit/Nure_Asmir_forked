import { insidePakistan } from "@/lib/geo";
import { computeDeliveryCharge, isDeliveryMode, isPaymentAllowed } from "@/lib/shop-rules";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  deliveryZones,
  discountCodes,
  discountRedemptions,
  inventoryMovements,
  orderItems,
  orderStatusHistory,
  orders,
  productVariants,
  products,
  siteSettings,
} from "@/db/schema";
import { sendOrderEmails } from "@/lib/email/resend";
import { sendOrderConfirmationWhatsApp, toWhatsAppPhone } from "@/lib/whatsapp";
import { notifyAdmins } from "@/lib/push/notify";
import { applySales, loadFreshActiveSales } from "@/lib/sales";
import { checkStockAlerts } from "@/lib/stock-alerts";
import { runInBackground } from "@/lib/background";
import {
  attachOrderToIdempotencyKey,
  claimIdempotencyKey,
  findOrderByIdempotencyKey,
  reclaimStaleIdempotencyKey,
  releaseIdempotencyKey,
} from "@/lib/idempotency";
import { isCheckoutRateLimited } from "@/lib/auth/rate-limit";
import { expireReservations } from "@/lib/orders";
import { cleanPhone } from "@/lib/slug";
import { checkCoupon, computeDiscountAmount } from "@/lib/coupons";
import { isOtpTokenValid } from "@/lib/checkout/otp";

export const dynamic = "force-dynamic";

type CheckoutItem = { variantId: string; quantity: number };

type OrderLine = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

type BankDetails = { name: string; accountTitle: string; accountNumber: string; iban: string };

type SiteSettingsRow = typeof siteSettings.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

function generateOrderNumber(): string {
  const now = new Date();
  const stamp = `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate(),
  ).padStart(2, "0")}`;
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `NA-${stamp}-${random}`;
}

function bankDetailsFrom(settings: SiteSettingsRow | undefined): BankDetails {
  return {
    name: settings?.bankName ?? "",
    accountTitle: settings?.bankAccountTitle ?? "",
    accountNumber: settings?.bankAccountNumber ?? "",
    iban: settings?.bankIban ?? "",
  };
}

async function loadSettings(): Promise<SiteSettingsRow | undefined> {
  const [settings] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  return settings;
}

function orderSummary(
  order: Pick<
    OrderRow,
    | "orderNumber"
    | "total"
    | "deliveryCharge"
    | "discount"
    | "reservationExpiresAt"
    | "paymentMethod"
    | "id"
    | "customerEmail"
    | "estimatedDeliveryDate"
  >,
  settings: SiteSettingsRow | undefined,
) {
  return {
    ok: true,
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: order.total,
    deliveryCharge: order.deliveryCharge,
    discount: order.discount,
    reservationExpiresAt: order.reservationExpiresAt ? order.reservationExpiresAt.toISOString() : null,
    paymentMethod: order.paymentMethod,
    whatsappNumber: settings?.whatsappNumber ?? "",
    bank: order.paymentMethod === "bank_deposit" ? bankDetailsFrom(settings) : undefined,
    // Both feed the Google Customer Reviews opt-in on the confirmation page (checkout/page.tsx) —
    // customerEmail is one of Google's required fields for it, so that widget simply doesn't render
    // when it's null (a phone-only order).
    customerEmail: order.customerEmail,
    estimatedDeliveryDate: order.estimatedDeliveryDate,
  };
}

/** Creates a checkout order after validation and stock reservation, reusing an existing order for the same idempotency key. */
export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return Response.json({ error: "Missing Idempotency-Key header." }, { status: 400 });
  }

  const existingOrder = await findOrderByIdempotencyKey(idempotencyKey);
  if (existingOrder) {
    const settings = await loadSettings();
    return Response.json(orderSummary(existingOrder, settings), { status: 200 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isCheckoutRateLimited(ip)) {
    return Response.json({ error: "Too many checkout attempts. Please wait a moment and try again." }, { status: 429 });
  }

  await expireReservations();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const customerName = String(body.customerName ?? "").trim();
  const customerPhone = cleanPhone(String(body.customerPhone ?? ""));
  const customerEmail = String(body.customerEmail ?? "").trim().toLowerCase() || null;
  const otpToken = String(body.otpToken ?? "").trim() || null;
  const city = String(body.city ?? "").trim();
  const province = String(body.province ?? "").trim();
  const address = String(body.address ?? "").trim();
  const zoneId = String(body.zoneId ?? "").trim();
  const paymentMethod = body.paymentMethod === "bank_deposit" ? "bank_deposit" : body.paymentMethod === "cod" ? "cod" : null;
  const notes = String(body.notes ?? "").trim() || null;
  // Optional pin from GPS / the map; a pin outside Pakistan (or junk) is simply ignored.
  const lat = Number(body.latitude);
  const lon = Number(body.longitude);
  const pin = body.latitude != null && body.longitude != null && insidePakistan(lat, lon) ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 } : null;
  const couponCode = String(body.couponCode ?? "").trim().toUpperCase() || null;
  const items: CheckoutItem[] = Array.isArray(body.items) ? (body.items as CheckoutItem[]) : [];

  const hasValidPhone = customerPhone.replace(/\D/g, "").length >= 10;

  if (customerName.length > 120 || city.length > 80 || province.length > 80 || address.length > 400 || (notes?.length ?? 0) > 1000) {
    return Response.json({ error: "One of the fields is too long." }, { status: 400 });
  }
  if (!customerName || !city || !province || !address || !zoneId || !paymentMethod) {
    return Response.json({ error: "Complete all required details before placing the order." }, { status: 400 });
  }
  if (!hasValidPhone && !customerEmail) {
    return Response.json({ error: "Enter your phone number or email so we can reach you." }, { status: 400 });
  }

  // A valid phone number is enough on its own to place an order — email OTP verification is only
  // required when email is the *sole* contact method given (see checkout/page.tsx's matching
  // emailOtpRequired logic and its "enter your WhatsApp number instead" popup).
  if (!hasValidPhone) {
    if (!otpToken || !customerEmail || !(await isOtpTokenValid(customerEmail, otpToken))) {
      return Response.json({ error: "Please verify your email before placing the order." }, { status: 400 });
    }
  }
  if (!items.length || items.length > 20) {
    return Response.json({ error: "Your bag must contain between 1 and 20 items." }, { status: 400 });
  }
  if (
    items.some(
      (item) => !item.variantId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10,
    )
  ) {
    return Response.json({ error: "The bag contains an invalid quantity." }, { status: 400 });
  }

  const variantIds = [...new Set(items.map((item) => item.variantId))];
  const variantRows = await db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      variantName: productVariants.name,
      sku: productVariants.sku,
      price: productVariants.price,
      stockQuantity: productVariants.stockQuantity,
      reservedQuantity: productVariants.reservedQuantity,
      variantStatus: productVariants.status,
      productName: products.name,
      productStatus: products.status,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));

  const variantById = new Map(variantRows.map((row) => [row.variantId, row]));
  if (variantById.size !== variantIds.length) {
    return Response.json({ error: "One of the selected products is no longer available." }, { status: 409 });
  }

  // Price is decided here, on the server, from the sales that are active *right now* — what the
  // shopper's (possibly cached) page or cart showed is only a preview.
  const activeSales = await loadFreshActiveSales();
  let subtotal = 0;
  const lines: OrderLine[] = [];
  for (const item of items) {
    const variant = variantById.get(item.variantId);
    if (!variant) {
      return Response.json({ error: "One of the selected products is no longer available." }, { status: 409 });
    }
    const available = variant.stockQuantity - variant.reservedQuantity;
    if (variant.productStatus !== "published" || variant.variantStatus !== "active" || available < item.quantity) {
      return Response.json({ error: `${variant.productName} does not have enough available stock.` }, { status: 409 });
    }
    const unitPrice = applySales(variant.price, variant.productId, activeSales)?.price ?? variant.price;
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    lines.push({
      variantId: variant.variantId,
      productId: variant.productId,
      productName: variant.productName,
      variantName: variant.variantName,
      sku: variant.sku,
      unitPrice,
      quantity: item.quantity,
      lineTotal,
    });
  }

  const [zone] = await db
    .select({ id: deliveryZones.id, deliveryCharge: deliveryZones.deliveryCharge, estimatedDaysMax: deliveryZones.estimatedDaysMax })
    .from(deliveryZones)
    .where(and(eq(deliveryZones.id, zoneId), eq(deliveryZones.active, true)))
    .limit(1);
  if (!zone) {
    return Response.json({ error: "Choose a valid delivery zone." }, { status: 400 });
  }
  // YYYY-MM-DD, matching the `date` column and what Google's Customer Reviews opt-in expects.
  const estimatedDeliveryDate = new Date(Date.now() + zone.estimatedDaysMax * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const settings = await loadSettings();
  // Bank transfer is only accepted while the owner has switched it on – a stale page or a hand-made request cannot sneak it in.
  if (!isPaymentAllowed(paymentMethod, settings?.bankDepositEnabled ?? false)) {
    return Response.json({ error: "Bank transfer is not available right now. Please choose cash on delivery." }, { status: 400 });
  }
  const deliveryCharge = computeDeliveryCharge({
    mode: isDeliveryMode(settings?.deliveryMode) ? settings.deliveryMode : "zones",
    subtotal,
    freeAbove: settings?.freeDeliveryThreshold ?? 10000,
    zoneCharge: zone.deliveryCharge,
    flatCharge: settings?.flatDeliveryCharge ?? 250,
  });

  let discount = 0;
  let appliedCouponId: string | null = null;
  if (couponCode) {
    const result = await checkCoupon(db, couponCode, subtotal);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    discount = computeDiscountAmount(result.coupon, subtotal, deliveryCharge);
    appliedCouponId = result.coupon.id;
  }

  const total = subtotal + deliveryCharge - discount;
  const reservationHours = paymentMethod === "cod" ? settings?.codReservationHours ?? 6 : settings?.bankReservationHours ?? 6;
  const reservationExpiresAt = new Date(Date.now() + reservationHours * 60 * 60 * 1000);
  const orderId = randomUUID();
  const orderNumber = generateOrderNumber();

  // NOTE: this project's Neon connection (db/index.ts) intentionally uses the stateless `neon-http`
  // driver, not a connection-pooling driver — Cloudflare Workers forbids reusing an I/O object
  // (sockets, pooled connections) across different requests, and a pooling driver caused real
  // production failures ("Cannot perform I/O on behalf of a different request"). That means
  // `db.transaction()` isn't available here. Instead, each guarded UPDATE below carries a WHERE
  // condition that only succeeds if the precondition (enough stock, coupon still under its cap)
  // still holds, so a lost race is caught explicitly rather than relying on rollback. If a later
  // step fails after stock was already reserved, we compensate by releasing it manually.
  const reserved: Array<{ variantId: string; quantity: number }> = [];
  async function releaseReservedStock(): Promise<void> {
    const now = new Date();
    for (const item of reserved) {
      try {
        await db
          .update(productVariants)
          .set({ reservedQuantity: sql`greatest(0, ${productVariants.reservedQuantity} - ${item.quantity})`, updatedAt: now })
          .where(eq(productVariants.id, item.variantId));
      } catch (releaseError) {
        console.error("Failed to release reserved stock after a failed checkout", item.variantId, releaseError);
      }
    }
  }

  // Claim the idempotency key right before the side-effecting work starts (stock reservation,
  // coupon redemption, the order write itself) — everything above this point is read-only
  // validation that's safe to redo on a genuine retry. See lib/idempotency.ts for why this closes
  // a real race: two requests carrying the same key could previously both pass a read-only
  // "does an order exist yet" check before either had written anything.
  let claimed = await claimIdempotencyKey(idempotencyKey);
  if (!claimed) {
    for (let attempt = 0; attempt < 5 && !claimed; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const inFlightOrder = await findOrderByIdempotencyKey(idempotencyKey);
      if (inFlightOrder) {
        const settings = await loadSettings();
        return Response.json(orderSummary(inFlightOrder, settings), { status: 200 });
      }
      // Nothing attached yet after several checks — either still genuinely in flight (keep
      // waiting) or the original claimant crashed before it could attach an order or release the
      // key on failure. reclaimStaleIdempotencyKey only succeeds once the claim is old enough to
      // be considered abandoned, so this can't steal a key from a request that's still running.
      claimed = await reclaimStaleIdempotencyKey(idempotencyKey);
    }
    if (!claimed) {
      return Response.json(
        { error: "Your order is still being processed — please wait a moment and try again." },
        { status: 409 },
      );
    }
  }

  try {
    for (const line of lines) {
      const updated = await db
        .update(productVariants)
        .set({
          reservedQuantity: sql`${productVariants.reservedQuantity} + ${line.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productVariants.id, line.variantId),
            sql`${productVariants.stockQuantity} - ${productVariants.reservedQuantity} >= ${line.quantity}`,
          ),
        )
        .returning({ id: productVariants.id });

      if (updated.length === 0) {
        await releaseReservedStock();
        await releaseIdempotencyKey(idempotencyKey);
        return Response.json({ error: `${line.productName} does not have enough available stock.` }, { status: 409 });
      }
      reserved.push({ variantId: line.variantId, quantity: line.quantity });
    }

    if (appliedCouponId) {
      // Guarded the same way as stock: only consume a redemption if the coupon is still active and
      // (unlimited OR under its cap) right now, so two concurrent checkouts can never both slip
      // through past a coupon's maxRedemptions.
      const consumed = await db
        .update(discountCodes)
        .set({ redemptionCount: sql`${discountCodes.redemptionCount} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(discountCodes.id, appliedCouponId),
            eq(discountCodes.active, true),
            sql`(${discountCodes.maxRedemptions} IS NULL OR ${discountCodes.redemptionCount} < ${discountCodes.maxRedemptions})`,
          ),
        )
        .returning({ id: discountCodes.id });
      if (consumed.length === 0) {
        await releaseReservedStock();
        await releaseIdempotencyKey(idempotencyKey);
        return Response.json({ error: "This coupon is no longer available. Please remove it and try again." }, { status: 409 });
      }
      await db.insert(discountRedemptions).values({ discountCodeId: appliedCouponId, orderId, amountDiscounted: discount });
    }

    await db.insert(orders).values({
      id: orderId,
      orderNumber,
      customerName,
      customerPhone,
      customerEmail,
      city,
      province,
      address,
      deliveryLatitude: pin?.lat ?? null,
      deliveryLongitude: pin?.lon ?? null,
      subtotal,
      deliveryCharge,
      discount,
      tax: 0,
      total,
      currency: "PKR",
      paymentMethod,
      paymentStatus: "pending",
      orderStatus: "pending_confirmation",
      reservationExpiresAt,
      notes,
      estimatedDeliveryDate,
    });
    await db.insert(orderStatusHistory).values({
      orderId,
      fromStatus: null,
      toStatus: "pending_confirmation",
      note: "Order placed",
      actorEmail: "customer",
    });
    for (const line of lines) {
      await db.insert(orderItems).values({
        orderId,
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        variantName: line.variantName,
        sku: line.sku,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      });
      await db.insert(inventoryMovements).values({
        variantId: line.variantId,
        type: "reservation",
        quantity: line.quantity,
        reason: "Checkout reservation",
        referenceType: "order",
        referenceId: orderId,
        actorEmail: "customer",
      });
    }
  } catch (error) {
    await releaseReservedStock();
    await releaseIdempotencyKey(idempotencyKey);
    console.error("Order write failed", error);
    return Response.json({ error: "The order could not be placed. Please try again." }, { status: 500 });
  }

  await attachOrderToIdempotencyKey(idempotencyKey, orderId);

  runInBackground(checkStockAlerts(lines.map((line) => line.variantId)), "checkStockAlerts");

  notifyAdmins({
    title: `New order ${orderNumber}`,
    body: `${customerName.slice(0, 60)} · Rs. ${total.toLocaleString("en-PK")} · ${paymentMethod === "bank_deposit" ? "Bank deposit" : "Cash on delivery"}`,
    url: "/admin/orders",
  });

  try {
    await sendOrderEmails({
      toEmail: customerEmail ?? "",
      orderNumber,
      customerName,
      total,
      currency: "PKR",
      items: lines.map((line) => ({
        productName: line.productName,
        variantName: line.variantName,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      })),
      paymentMethod,
      bank: paymentMethod === "bank_deposit" ? bankDetailsFrom(settings) : undefined,
      whatsappNumber: settings?.whatsappNumber,
    });
  } catch (error) {
    console.error("sendOrderEmails failed", error);
  }

  if (hasValidPhone) {
    try {
      const whatsappMessageId = await sendOrderConfirmationWhatsApp({
        toPhone: toWhatsAppPhone(customerPhone),
        customerName,
        orderNumber,
        total,
      });
      if (whatsappMessageId) {
        await db.update(orders).set({ whatsappMessageId }).where(eq(orders.id, orderId));
      }
    } catch (error) {
      console.error("sendOrderConfirmationWhatsApp failed", error);
    }
  }

  return Response.json(
    orderSummary(
      {
        id: orderId,
        orderNumber,
        total,
        deliveryCharge,
        discount,
        reservationExpiresAt,
        paymentMethod,
        customerEmail,
        estimatedDeliveryDate,
      },
      settings,
    ),
    { status: 201 },
  );
}
