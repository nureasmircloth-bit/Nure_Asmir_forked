import { computeDeliveryCharge, isDeliveryMode, type DeliveryMode } from "@/lib/shop-rules";
// Admin-side order placement ("place an order on behalf of a customer"), single or bulk.
//
// Mirrors the rules of public checkout (app/api/orders/route.ts) — published product, active
// variant, enough unreserved stock, delivery charge from the chosen zone with the free-delivery
// threshold — but the order is created already *confirmed*, with the admin as the actor. Checkout
// itself is deliberately untouched; this is a separate path so it can't change how customers order.
//
// Like checkout, this runs on D1 (no interactive db.transaction), so stock is
// reserved with guarded UPDATEs and compensated by hand if a later write fails.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inChunks } from "@/db/sql-compat";
import { deliveryZones, inventoryMovements, orderItems, orderStatusHistory, orders, productVariants, products, siteSettings } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import {
  attachOrderToIdempotencyKey,
  claimIdempotencyKey,
  findOrderByIdempotencyKey,
  reclaimStaleIdempotencyKey,
  releaseIdempotencyKey,
} from "@/lib/idempotency";
import { cleanPhone } from "@/lib/slug";

export const MAX_ITEMS_PER_ORDER = 20;
export const MAX_QTY_PER_ITEM = 100;
export const MAX_BULK_ORDERS = 100;

// ---------------------------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------------------------

const itemSchema = z
  .object({
    sku: z.string().trim().min(1).max(100).optional(),
    variantId: z.string().uuid("variantId must be a valid id").optional(),
    quantity: z.number("quantity must be a number").int("quantity must be a whole number").min(1).max(MAX_QTY_PER_ITEM),
  })
  .strict()
  .refine((item) => Boolean(item.sku || item.variantId), { message: "each item needs a sku (or variantId)" });

const orderSchema = z
  .object({
    customerName: z.string().trim().min(1, "customerName is required").max(120),
    customerPhone: z.string().trim().min(1, "customerPhone is required").max(40),
    customerEmail: z.string().trim().max(160).nullish(),
    city: z.string().trim().min(1, "city is required").max(80),
    province: z.string().trim().min(1, "province is required").max(60),
    address: z.string().trim().min(1, "address is required").max(400),
    // Either the zone's name (what the JSON template uses) or its id (what the admin form sends).
    zone: z.string().trim().max(120).optional(),
    zoneId: z.string().uuid("zoneId must be a valid id").optional(),
    paymentMethod: z.enum(["cod", "bank_deposit"], { error: 'paymentMethod must be "cod" or "bank_deposit"' }),
    paymentStatus: z.enum(["pending", "paid"], { error: 'paymentStatus must be "pending" or "paid"' }).optional(),
    deliveryCharge: z.number("deliveryCharge must be a number").int().min(0).max(100000).optional(),
    discount: z.number("discount must be a number").int().min(0).max(10000000).optional(),
    notes: z.string().trim().max(1000).nullish(),
    items: z.array(itemSchema).min(1, "at least one item is required").max(MAX_ITEMS_PER_ORDER, `at most ${MAX_ITEMS_PER_ORDER} items per order`),
  })
  .strict();

export type PlaceOrderInput = z.input<typeof orderSchema>;

/** Keys starting with "_" (the template's _readme etc.) are documentation — dropped, not errors. */
function stripComments(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !key.startsWith("_")));
}

function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join(".") : "";
    const message = issue.code === "unrecognized_keys" ? `unknown field(s): ${(issue as { keys?: string[] }).keys?.join(", ")}` : issue.message;
    return path && !message.startsWith(path) ? `${path}: ${message}` : message;
  });
}

// ---------------------------------------------------------------------------------------------
// Resolving an input against the live catalogue (no writes)
// ---------------------------------------------------------------------------------------------

type VariantRow = {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: string;
  variantName: string;
  sku: string;
  price: number;
  variantStatus: string;
  stockQuantity: number;
  reservedQuantity: number;
};

type ZoneRow = { id: string; name: string; deliveryCharge: number; estimatedDaysMax: number };

export type Catalog = {
  zones: ZoneRow[];
  freeDeliveryThreshold: number;
  deliveryMode: DeliveryMode;
  flatDeliveryCharge: number;
  variantsBySku: Map<string, VariantRow>; // keyed by lower-cased sku
  variantsById: Map<string, VariantRow>;
};

export type PlannedLine = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type OrderPlan = {
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  city: string;
  province: string;
  address: string;
  zone: ZoneRow;
  paymentMethod: "cod" | "bank_deposit";
  paymentStatus: "pending" | "paid";
  notes: string | null;
  lines: PlannedLine[];
  subtotal: number;
  deliveryCharge: number;
  discount: number;
  total: number;
  estimatedDeliveryDate: string;
};

export type ResolveResult = { ok: true; plan: OrderPlan } | { ok: false; errors: string[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (value: string) => value.trim().toLowerCase();

/** Loads only what the given inputs reference (their SKUs/ids), plus the active zones and the
 * free-delivery threshold — one round of queries whether it's one order or a hundred. */
export async function loadCatalog(inputs: unknown[]): Promise<Catalog> {
  const skus = new Set<string>();
  const ids = new Set<string>();
  for (const raw of inputs) {
    const items = (raw as { items?: unknown })?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const sku = (item as { sku?: unknown })?.sku;
      const variantId = (item as { variantId?: unknown })?.variantId;
      if (typeof sku === "string" && sku.trim()) skus.add(lower(sku));
      if (typeof variantId === "string" && z.string().uuid().safeParse(variantId).success) ids.add(variantId);
    }
  }

  const select = {
    variantId: productVariants.id,
    productId: productVariants.productId,
    productName: products.name,
    productSlug: products.slug,
    productStatus: products.status,
    variantName: productVariants.name,
    sku: productVariants.sku,
    price: productVariants.price,
    variantStatus: productVariants.status,
    stockQuantity: productVariants.stockQuantity,
    reservedQuantity: productVariants.reservedQuantity,
  };
  const [zones, settingsRows, variantRows] = await Promise.all([
    db
      .select({ id: deliveryZones.id, name: deliveryZones.name, deliveryCharge: deliveryZones.deliveryCharge, estimatedDaysMax: deliveryZones.estimatedDaysMax })
      .from(deliveryZones)
      .where(eq(deliveryZones.active, true)),
    db.select({ freeDeliveryThreshold: siteSettings.freeDeliveryThreshold, deliveryMode: siteSettings.deliveryMode, flatDeliveryCharge: siteSettings.flatDeliveryCharge }).from(siteSettings).where(eq(siteSettings.id, "store")).limit(1),
    // Long lists (a big sheet of orders) are looked up in pieces: the database takes at most 100 values in one statement.
    Promise.all([
      inChunks([...skus], (part) => db.select(select).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(sql<string>`lower(${productVariants.sku})`, part))),
      inChunks([...ids], (part) => db.select(select).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(inArray(productVariants.id, part))),
    ]).then(([bySku, byId]) => [...bySku, ...byId] as VariantRow[]),
  ]);

  return {
    zones,
    freeDeliveryThreshold: settingsRows[0]?.freeDeliveryThreshold ?? 10000,
    deliveryMode: isDeliveryMode(settingsRows[0]?.deliveryMode) ? settingsRows[0].deliveryMode : "zones",
    flatDeliveryCharge: settingsRows[0]?.flatDeliveryCharge ?? 250,
    variantsBySku: new Map(variantRows.map((row) => [lower(row.sku), row])),
    variantsById: new Map(variantRows.map((row) => [row.variantId, row])),
  };
}

/**
 * Validates one raw order against the catalogue and, if it's placeable, computes the full plan
 * (lines, totals, zone, delivery estimate). Never writes. `consumed` tracks stock already spoken for
 * by earlier orders in the same bulk batch, so a preview of a file warns when a *later* order would
 * run the shelf dry, exactly as placing them in file order would.
 */
export function resolveOrder(raw: unknown, catalog: Catalog, consumed?: Map<string, number>): ResolveResult {
  const parsed = orderSchema.safeParse(stripComments(raw));
  if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) };
  const input = parsed.data;
  const errors: string[] = [];

  const phone = cleanPhone(input.customerPhone);
  if (phone.replace(/\D/g, "").length < 10) errors.push("customerPhone: enter a valid phone number (at least 10 digits)");

  const email = input.customerEmail ? input.customerEmail.trim().toLowerCase() : null;
  if (email && !EMAIL.test(email)) errors.push("customerEmail: not a valid email address (leave it out if there isn't one)");

  let zone: ZoneRow | undefined;
  if (input.zoneId) zone = catalog.zones.find((candidate) => candidate.id === input.zoneId);
  else if (input.zone) zone = catalog.zones.find((candidate) => lower(candidate.name) === lower(input.zone as string));
  if (!zone) {
    errors.push(
      input.zoneId || input.zone
        ? `zone: "${input.zone ?? input.zoneId}" isn't an active delivery zone (use one of: ${catalog.zones.map((candidate) => candidate.name).join(", ") || "none configured"})`
        : "zone: a delivery zone is required",
    );
  }

  // Merge repeated lines for the same variant so stock is checked against the combined quantity.
  const wanted = new Map<string, { variant: VariantRow; quantity: number }>();
  input.items.forEach((item, index) => {
    const variant = item.variantId ? catalog.variantsById.get(item.variantId) : catalog.variantsBySku.get(lower(item.sku as string));
    if (!variant) {
      errors.push(`items.${index}: no product variant found for ${item.variantId ? `id ${item.variantId}` : `sku "${item.sku}"`}`);
      return;
    }
    const existing = wanted.get(variant.variantId);
    if (existing) existing.quantity += item.quantity;
    else wanted.set(variant.variantId, { variant, quantity: item.quantity });
  });

  const lines: PlannedLine[] = [];
  for (const { variant, quantity } of wanted.values()) {
    const label = `${variant.productName} (${variant.sku})`;
    if (variant.productStatus !== "published" || variant.variantStatus !== "active") {
      errors.push(`${label}: not available for sale (unpublished or inactive) — publish it first`);
      continue;
    }
    const available = variant.stockQuantity - variant.reservedQuantity - (consumed?.get(variant.variantId) ?? 0);
    if (available < quantity) {
      errors.push(`${label}: only ${Math.max(0, available)} in stock, ${quantity} requested`);
      continue;
    }
    lines.push({
      variantId: variant.variantId,
      productId: variant.productId,
      productName: variant.productName,
      variantName: variant.variantName,
      sku: variant.sku,
      unitPrice: variant.price,
      quantity,
      lineTotal: variant.price * quantity,
    });
  }

  if (errors.length || !zone) return { ok: false, errors };

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const deliveryCharge = input.deliveryCharge ?? computeDeliveryCharge({ mode: catalog.deliveryMode, subtotal, freeAbove: catalog.freeDeliveryThreshold, zoneCharge: zone.deliveryCharge, flatCharge: catalog.flatDeliveryCharge });
  const discount = input.discount ?? 0;
  if (discount > subtotal + deliveryCharge) return { ok: false, errors: [`discount: PKR ${discount} is more than the order's value (PKR ${subtotal + deliveryCharge})`] };

  if (consumed) for (const line of lines) consumed.set(line.variantId, (consumed.get(line.variantId) ?? 0) + line.quantity);

  return {
    ok: true,
    plan: {
      customerName: input.customerName,
      customerPhone: phone,
      customerEmail: email,
      city: input.city,
      province: input.province,
      address: input.address,
      zone,
      paymentMethod: input.paymentMethod,
      paymentStatus: input.paymentStatus ?? "pending",
      notes: input.notes?.trim() || null,
      lines,
      subtotal,
      deliveryCharge,
      discount,
      total: subtotal + deliveryCharge - discount,
      estimatedDeliveryDate: new Date(Date.now() + zone.estimatedDaysMax * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    },
  };
}

export type PreviewRow =
  | { ok: true; customerName: string; city: string; itemsLabel: string; subtotal: number; deliveryCharge: number; discount: number; total: number }
  | { ok: false; customerName: string; city: string; errors: string[] };

/** Dry run of many orders at once (bulk upload preview). Rows are checked in file order against a
 * shared running stock tally, so the preview matches what placing them one after another would do. */
export async function previewOrders(rawOrders: unknown[]): Promise<PreviewRow[]> {
  const catalog = await loadCatalog(rawOrders);
  const consumed = new Map<string, number>();
  return rawOrders.map((raw) => {
    const result = resolveOrder(raw, catalog, consumed);
    const source = (stripComments(raw) ?? {}) as { customerName?: unknown; city?: unknown };
    const customerName = typeof source.customerName === "string" ? source.customerName : "";
    const city = typeof source.city === "string" ? source.city : "";
    if (!result.ok) return { ok: false, customerName, city, errors: result.errors };
    const { plan } = result;
    return {
      ok: true,
      customerName: plan.customerName,
      city: plan.city,
      itemsLabel: plan.lines.map((line) => `${line.quantity}× ${line.productName}`).join(", "),
      subtotal: plan.subtotal,
      deliveryCharge: plan.deliveryCharge,
      discount: plan.discount,
      total: plan.total,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Placing (writes)
// ---------------------------------------------------------------------------------------------

function generateOrderNumber(): string {
  const now = new Date();
  const stamp = `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `NA-${stamp}-${random}`;
}

export type PlacedOrder = {
  orderId: string;
  orderNumber: string;
  total: number;
  customerName: string;
  duplicate: boolean;
};
export type PlaceResult = { ok: true; order: PlacedOrder } | { ok: false; errors: string[] };

const KEY_PREFIX = "admin:";

/**
 * Places one order, already confirmed, on the customer's behalf. `idempotencyKey` (generated once
 * per order by the admin UI) makes a retried or double-submitted request return the order the first
 * attempt created instead of creating a second one — the same guarantee checkout gives customers.
 */
export async function placeAdminOrder(raw: unknown, adminEmail: string, idempotencyKey?: string): Promise<PlaceResult> {
  const key = idempotencyKey ? `${KEY_PREFIX}${idempotencyKey}` : null;

  if (key) {
    let claimed = await claimIdempotencyKey(key);
    if (!claimed) {
      // Already claimed: either that request finished (return its order) or is still running (wait a
      // moment), or it died mid-flight (reclaim once the claim is old enough) — as in checkout.
      for (let attempt = 0; attempt < 5 && !claimed; attempt++) {
        const existing = await findOrderByIdempotencyKey(key);
        if (existing) {
          return { ok: true, order: { orderId: existing.id, orderNumber: existing.orderNumber, total: existing.total, customerName: existing.customerName, duplicate: true } };
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        claimed = await reclaimStaleIdempotencyKey(key);
      }
      if (!claimed) return { ok: false, errors: ["This order is already being processed — check the order list before trying again."] };
    }
  }

  const releaseKey = async () => {
    if (key) await releaseIdempotencyKey(key);
  };

  const catalog = await loadCatalog([raw]);
  const resolved = resolveOrder(raw, catalog);
  if (!resolved.ok) {
    await releaseKey();
    return resolved;
  }
  const plan = resolved.plan;

  const orderId = randomUUID();
  const orderNumber = generateOrderNumber();
  const reserved: Array<{ variantId: string; quantity: number }> = [];
  let orderInserted = false;

  const compensate = async () => {
    const now = new Date();
    for (const line of reserved) {
      try {
        await db
          .update(productVariants)
          .set({ reservedQuantity: sql`max(0, ${productVariants.reservedQuantity} - ${line.quantity})`, updatedAt: now })
          .where(eq(productVariants.id, line.variantId));
      } catch (error) {
        console.error("Failed to release stock after a failed admin order", line.variantId, error);
      }
    }
    try {
      // Removes the order (cascades to its items and history) and the reservation ledger rows, so a
      // failed placement leaves no half-created order behind.
      if (orderInserted) await db.delete(orders).where(eq(orders.id, orderId));
      await db.delete(inventoryMovements).where(and(eq(inventoryMovements.referenceType, "order"), eq(inventoryMovements.referenceId, orderId)));
    } catch (error) {
      console.error("Failed to clean up a failed admin order", orderId, error);
    }
  };

  try {
    for (const line of plan.lines) {
      const updated = await db
        .update(productVariants)
        .set({ reservedQuantity: sql`${productVariants.reservedQuantity} + ${line.quantity}`, updatedAt: new Date() })
        .where(and(eq(productVariants.id, line.variantId), sql`${productVariants.stockQuantity} - ${productVariants.reservedQuantity} >= ${line.quantity}`))
        .returning({ id: productVariants.id });
      if (updated.length === 0) {
        await compensate();
        await releaseKey();
        return { ok: false, errors: [`${line.productName} (${line.sku}): stock just ran out — someone else ordered it first`] };
      }
      reserved.push({ variantId: line.variantId, quantity: line.quantity });
    }

    await db.insert(orders).values({
      id: orderId,
      orderNumber,
      customerName: plan.customerName,
      customerPhone: plan.customerPhone,
      customerEmail: plan.customerEmail,
      city: plan.city,
      province: plan.province,
      address: plan.address,
      subtotal: plan.subtotal,
      deliveryCharge: plan.deliveryCharge,
      discount: plan.discount,
      tax: 0,
      total: plan.total,
      currency: "PKR",
      paymentMethod: plan.paymentMethod,
      paymentStatus: plan.paymentStatus,
      orderStatus: "confirmed",
      // Confirmed orders never expire (the expiry sweep only touches pending_confirmation ones).
      reservationExpiresAt: null,
      notes: plan.notes,
      estimatedDeliveryDate: plan.estimatedDeliveryDate,
    });
    orderInserted = true;

    await db.insert(orderStatusHistory).values({
      orderId,
      fromStatus: null,
      toStatus: "confirmed",
      note: "Order placed by admin on behalf of the customer (confirmed)",
      actorEmail: adminEmail,
    });
    for (const line of plan.lines) {
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
        reason: "Order placed by admin",
        referenceType: "order",
        referenceId: orderId,
        actorEmail: adminEmail,
      });
    }
  } catch (error) {
    console.error("Admin order placement failed", error);
    await compensate();
    await releaseKey();
    return { ok: false, errors: ["The order could not be saved. Nothing was changed — please try again."] };
  }

  if (key) await attachOrderToIdempotencyKey(key, orderId);
  try {
    await auditLogEntry({
      actorEmail: adminEmail,
      action: "order.admin_create",
      entityType: "order",
      entityId: orderId,
      detail: { orderNumber, total: plan.total, items: plan.lines.length, paymentMethod: plan.paymentMethod, paymentStatus: plan.paymentStatus },
    });
  } catch (error) {
    console.error("Audit log failed for admin order", orderId, error);
  }

  return { ok: true, order: { orderId, orderNumber, total: plan.total, customerName: plan.customerName, duplicate: false } };
}
