import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const adminOwners = pgTable("admin_owners", {
  email: text("email").primaryKey(),
  displayName: text("display_name"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  adminEmail: text("admin_email").notNull().references(() => adminOwners.email, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("admin_sessions_email_idx").on(table.adminEmail)]);

// Browser/phone push registrations (Firebase Cloud Messaging) for the owner's order alerts. One row
// per device token; tokens FCM reports as unregistered are deleted on the next send.
export const adminPushDevices = pgTable("admin_push_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminEmail: text("admin_email").notNull().references(() => adminOwners.email, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("admin_push_devices_email_idx").on(table.adminEmail)]);

export const loginAttempts = pgTable("login_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  ip: text("ip").notNull(),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("login_attempts_email_idx").on(table.email, table.createdAt)]);

// Checkout email verification: a customer requests a 6-digit code, receives it via Resend, and
// submits it back before the order can be created. `verifiedToken` is only set once the code
// checks out and is what /api/orders actually validates — the code itself never travels past
// verify-otp. `otpHash` is a SHA-256 digest, not a password hash: OTPs are short-lived, single-use,
// and rate-limited, so a fast hash is fine here (see lib/checkout/otp.ts).
export const checkoutVerifications = pgTable("checkout_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  ip: text("ip").notNull(),
  otpHash: text("otp_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  verified: boolean("verified").notNull().default(false),
  verifiedToken: text("verified_token").unique(),
  verifiedUntil: timestamp("verified_until", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("checkout_verifications_email_idx").on(table.email, table.createdAt)]);

export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("admin_audit_entity_idx").on(table.entityType, table.entityId)]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Cover image for the homepage "Objects of everyday elegance" cards (a tall 3:4 crop) — all
  // nullable since a category can exist (and did, for every category before this feature) without
  // one; the storefront falls back to a static placeholder in that case.
  imageR2Key: text("image_r2_key"),
  imageAltText: text("image_alt_text"),
  imageContentType: text("image_content_type"),
  imageByteSize: integer("image_byte_size"),
  imageBlurDataUrl: text("image_blur_data_url"),
  imageVariantWidths: jsonb("image_variant_widths").$type<number[]>(),
  // A separate, wide crop for the /collections/[slug] hero banner — that section is short and
  // wide, nothing like the tall card above, so stretching the same crop into both places always
  // looked wrong in one of them. Optional: falls back to the card image above if never set, so
  // every category created before this feature keeps working unchanged.
  heroR2Key: text("hero_r2_key"),
  heroAltText: text("hero_alt_text"),
  heroContentType: text("hero_content_type"),
  heroByteSize: integer("hero_byte_size"),
  heroBlurDataUrl: text("hero_blur_data_url"),
  heroVariantWidths: jsonb("hero_variant_widths").$type<number[]>(),
  ...timestamps,
}, (table) => [index("categories_status_idx").on(table.status)]);

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  typeLabel: text("type_label").notNull(),
  shortDescription: text("short_description"),
  description: text("description"),
  material: text("material"),
  dimensions: text("dimensions"),
  careInstructions: text("care_instructions"),
  // SEO / feed fields
  status: text("status").notNull().default("draft"),
  featured: boolean("featured").notNull().default(false),
  badge: text("badge"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  // Extra search phrases the owner adds by hand (comma separated). Google ignores keyword lists; the shop uses them for its own search, structured data and the AI writer.
  seoKeywords: text("seo_keywords"),
  // true once the owner has written the Google title/description by hand: saving the product then never replaces them with an AI draft.
  seoLocked: boolean("seo_locked").notNull().default(false),
  // Google Merchant Center / Meta catalogue fields
  pattern: text("pattern"),
  primaryColour: text("primary_colour"),
  occasion: text("occasion"),
  style: text("style"),
  countryOfOrigin: text("country_of_origin"),
  gender: text("gender").notNull().default("male"),
  googleProductCategory: text("google_product_category"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("products_category_idx").on(table.categoryId),
  index("products_status_idx").on(table.status),
  index("products_featured_idx").on(table.featured),
]);

export const productVariants = pgTable("product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  color: text("color").notNull(),
  size: text("size"),
  fabric: text("fabric"),
  gtin: text("gtin"),
  price: integer("price").notNull(),
  compareAtPrice: integer("compare_at_price"),
  currency: text("currency").notNull().default("PKR"),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  reservedQuantity: integer("reserved_quantity").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
  // Last stock level the owner was alerted about ("ok" | "low" | "out") so a push goes out once per
  // transition instead of on every order — see lib/stock-alerts.ts.
  stockAlertState: text("stock_alert_state").notNull().default("ok"),
  isDefault: boolean("is_default").notNull().default(false),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, (table) => [
  index("variants_product_idx").on(table.productId),
  index("variants_stock_idx").on(table.stockQuantity),
]);

export const productImages = pgTable("product_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  r2Key: text("r2_key").notNull().unique(),
  altText: text("alt_text").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width"),
  height: integer("height"),
  focalPointX: integer("focal_point_x").notNull().default(50),
  focalPointY: integer("focal_point_y").notNull().default(50),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: text("status").notNull().default("active"),
  // Tiny base64 WebP data URL for a blur-up placeholder, and the set of resized WebP variant
  // widths actually generated for this image (see lib/image-processing.ts) — both null for images
  // uploaded before this pipeline existed, or if processing failed and only the original was kept.
  blurDataUrl: text("blur_data_url"),
  variantWidths: jsonb("variant_widths").$type<number[]>(),
  // Set once the photo has been squeezed harder (sold-out items kept for the record) – see lib/photo-compaction.ts.
  compactedAt: timestamp("compacted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("images_product_idx").on(table.productId)]);

export const campaignSlides = pgTable("campaign_slides", {
  id: uuid("id").primaryKey().defaultRandom(),
  r2Key: text("r2_key").notNull().unique(),
  altText: text("alt_text").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  eyebrow: text("eyebrow").notNull().default("New arrivals"),
  headline: text("headline").notNull().default("Tradition in a modern form"),
  body: text("body").notNull().default("Shalwar kameez, shirts, pants and accessories for the modern man."),
  ctaLabel: text("cta_label").notNull().default("Shop now"),
  ctaHref: text("cta_href").notNull().default("/shop"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  blurDataUrl: text("blur_data_url"),
  variantWidths: jsonb("variant_widths").$type<number[]>(),
  // A separately cropped image for narrow (mobile) viewports — set at upload time in the admin
  // panel by cropping the same or a different source photo to a 9:16 target. Optional: falls back
  // to the desktop image above (r2Key) if never set, so existing slides keep working unchanged.
  mobileR2Key: text("mobile_r2_key"),
  mobileContentType: text("mobile_content_type"),
  mobileByteSize: integer("mobile_byte_size"),
  mobileBlurDataUrl: text("mobile_blur_data_url"),
  mobileVariantWidths: jsonb("mobile_variant_widths").$type<number[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("campaign_slides_order_idx").on(table.active, table.sortOrder)]);

export const productCollections = pgTable("product_collections", {
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.productId, table.collectionId] }),
]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  quantity: integer("quantity").notNull(),
  reason: text("reason"),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  actorEmail: text("actor_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("inventory_variant_idx").on(table.variantId)]);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNumber: text("order_number").notNull().unique(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email"),
  city: text("city").notNull(),
  province: text("province").notNull(),
  address: text("address").notNull(),
  // Where the shopper dropped the pin / their GPS said (optional; shown to the owner as a map link).
  deliveryLatitude: doublePrecision("delivery_latitude"),
  deliveryLongitude: doublePrecision("delivery_longitude"),
  deliveryNotes: text("delivery_notes"),
  subtotal: integer("subtotal").notNull(),
  deliveryCharge: integer("delivery_charge").notNull().default(0),
  discount: integer("discount").notNull().default(0),
  tax: integer("tax").notNull().default(0),
  total: integer("total").notNull(),
  currency: text("currency").notNull().default("PKR"),
  paymentMethod: text("payment_method").notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"),
  orderStatus: text("order_status").notNull().default("pending_confirmation"),
  reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
  // Set once a "please confirm your order" reminder has gone out, so the cron job never sends it
  // twice for the same order (see lib/orders.ts's sendReservationReminders).
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  notes: text("notes"),
  // The WhatsApp message ID returned when the order-confirmation template (with Confirm/Cancel
  // buttons) was sent — see lib/whatsapp.ts and app/api/whatsapp/webhook/route.ts. When the
  // customer taps a button, Meta's webhook payload includes `context.id`, the ID of the message
  // being replied to; matching it against this column is how a button tap gets connected back to
  // the specific order, since WhatsApp doesn't otherwise carry our own order ID in the reply.
  whatsappMessageId: text("whatsapp_message_id"),
  // Computed once at order creation from the chosen delivery zone's estimatedDaysMax, and reused
  // as-is afterward (e.g. by the Google Customer Reviews opt-in on the confirmation page) rather
  // than recomputed — the zone's estimate can change later, but the promise already made to this
  // specific customer at checkout shouldn't.
  estimatedDeliveryDate: date("estimated_delivery_date"),
  // Courier booking (TCS — see lib/tcs.ts and lib/courier.ts). Null until the parcel is booked. While a
  // booking request is in flight this holds the sentinel "PENDING" (with courierBookedAt as the claim
  // time) so a double-click can't book the same order twice; it is replaced by the real consignment
  // (CN) number on success, or reset to null on failure. An admin can also type in a CN booked by hand
  // on the TCS portal.
  courierName: text("courier_name").notNull().default("TCS"),
  courierTrackingNumber: text("courier_tracking_number"),
  courierBookedAt: timestamp("courier_booked_at", { withTimezone: true }),
  // The courier's own last-known status text ("Shipment Picked Up", "Out For Delivery", "Delivered", …),
  // refreshed by the scheduled sync and read by the customer tracking page so it never calls TCS itself.
  courierStatus: text("courier_status"),
  courierSyncedAt: timestamp("courier_synced_at", { withTimezone: true }),
  courierAutoAttempts: integer("courier_auto_attempts").notNull().default(0),
  courierAutoError: text("courier_auto_error"),
  // The moment TCS physically took the parcel. From here on the order can no longer be cancelled
  // (lib/order-rules.ts) — a refusal at the door comes back as a return instead.
  handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  cancelledBy: text("cancelled_by"),
  ...timestamps,
}, (table) => [
  index("orders_phone_idx").on(table.customerPhone),
  index("orders_status_idx").on(table.orderStatus),
  index("orders_created_idx").on(table.createdAt),
]);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  variantName: text("variant_name").notNull(),
  sku: text("sku").notNull(),
  imageUrl: text("image_url"),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
}, (table) => [index("order_items_order_idx").on(table.orderId)]);

// Time-boxed storewide or per-product discounts ("flash sales"). The price a shopper pays is always
// computed server-side at order time from the sales active *right then* (lib/sales.ts), so a stale
// cached page or a tampered cart can never get a discount that has ended.
export const flashSales = pgTable("flash_sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  discountType: text("discount_type").notNull(), // "percent" | "fixed"
  discountValue: integer("discount_value").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
  appliesToAll: boolean("applies_to_all").notNull().default(false),
  // Set once the "sale is live" push has gone out, so the cron never alerts twice.
  startNotifiedAt: timestamp("start_notified_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("flash_sales_window_idx").on(table.active, table.startsAt, table.endsAt)]);

export const flashSaleProducts = pgTable("flash_sale_products", {
  saleId: uuid("sale_id").notNull().references(() => flashSales.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.saleId, table.productId] })]);

// Shopper devices that opted into push (Firebase Cloud Messaging): order updates for the orders they
// placed on this device and sale alerts for wishlisted products. No account exists for shoppers, so a
// device is tied to an order only after proving the order number + phone number.
export const customerPushDevices = pgTable("customer_push_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  orderNumbers: jsonb("order_numbers").$type<string[]>().notNull().default([]),
  wishlist: jsonb("wishlist").$type<string[]>().notNull().default([]),
  salesOptIn: boolean("sales_opt_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per (order, lifecycle event) that has already been announced to the customer — makes the
// notifications idempotent when an admin double-clicks or a webhook is retried.
export const orderEventsSent = pgTable("order_events_sent", {
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.orderId, table.event] })]);

export const orderStatusHistory = pgTable("order_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  actorEmail: text("actor_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("order_history_order_idx").on(table.orderId)]);

export const orderIdempotencyKeys = pgTable("order_idempotency_keys", {
  key: text("key").primaryKey(),
  // Nullable: the key is claimed (this row inserted) *before* the order it will belong to exists —
  // see claimIdempotencyKey in lib/idempotency.ts — then filled in once that order is actually
  // created. A row with a null orderId means someone is still in the middle of processing this key.
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentProofs = pgTable("payment_proofs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("payment_proofs_order_idx").on(table.orderId)]);

export const subscribers = pgTable("subscribers", {
  email: text("email").primaryKey(),
  firstName: text("first_name"),
  source: text("source").notNull().default("website"),
  status: text("status").notNull().default("subscribed"),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Physical shops. The owner can add as many as needed; they show in the website footer and on the Contact page. */
export const storeLocations = pgTable("store_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull().default(""),
  phone: text("phone").notNull().default(""),
  hours: text("hours").notNull().default(""),
  // Found by the address search (Geoapify); optional – a shop without a pin still shows its written address.
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  isMain: boolean("is_main").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const siteSettings = pgTable("site_settings", {
  id: text("id").primaryKey().default("store"),
  brandName: text("brand_name").notNull().default("Nure Asmir"),
  whatsappNumber: text("whatsapp_number").notNull().default(""),
  supportPhone: text("support_phone").notNull().default(""),
  supportEmail: text("support_email").notNull().default(""),
  instagramUrl: text("instagram_url").notNull().default(""),
  facebookUrl: text("facebook_url").notNull().default(""),
  tiktokUrl: text("tiktok_url").notNull().default(""),
  // A wa.me "message" link (opens a chat with the business) — preferred over building one from the number.
  whatsappChatUrl: text("whatsapp_chat_url").notNull().default(""),
  // TCS "from" details printed on every booking (credentials live in env, never here).
  tcsShipperName: text("tcs_shipper_name").notNull().default("Nure Asmir"),
  tcsShipperAddress: text("tcs_shipper_address").notNull().default(""),
  tcsShipperCityName: text("tcs_shipper_city_name").notNull().default("Karachi"),
  tcsShipperCityCode: text("tcs_shipper_city_code").notNull().default("KHI"),
  tcsShipperPhone: text("tcs_shipper_phone").notNull().default(""),
  // How many days after delivery a shopper may ask for a refund.
  refundWindowDays: integer("refund_window_days").notNull().default(7),
  // Advanced: hide a product from the shop once everything in it has been sold out for this many days. 0 = keep forever.
  soldoutHideDays: integer("soldout_hide_days").notNull().default(90),
  // Advanced: the codes Google Search Console and Bing Webmaster Tools give to prove the shop owns the website.
  // The strip at the very top of every page. "auto" builds it from the shop's real rules (cash on delivery, free delivery above X);
  // "custom" shows only the owner's own lines; "off" hides it. The owner's extra lines (one per line) are added in "auto" mode.
  announcementMode: text("announcement_mode").notNull().default("auto"),
  announcementLines: text("announcement_lines").notNull().default(""),
  // How the lines move: "rotate" (one line slides in after another) or "scroll" (all lines glide from left to right in one loop).
  announcementStyle: text("announcement_style").notNull().default("rotate"),
  // The "Our story" page text, editable in the admin. Empty = the built-in wording. Paragraphs are separated by a blank line;
  // a paragraph starting with "> " is shown as the large quote.
  aboutHeading: text("about_heading").notNull().default(""),
  aboutBody: text("about_body").notNull().default(""),
  // Customers can pay by bank transfer only when this is switched on (cash on delivery is always offered).
  bankDepositEnabled: boolean("bank_deposit_enabled").notNull().default(false),
  // How the delivery charge is worked out: "zones" (a price per area), "flat" (one price everywhere) or "tcs" (TCS tariff by city,
  // falling back to the area prices until TCS rates are available). Free above freeDeliveryThreshold in every mode.
  deliveryMode: text("delivery_mode").notNull().default("zones"),
  flatDeliveryCharge: integer("flat_delivery_charge").notNull().default(250),
  googleSiteVerification: text("google_site_verification").notNull().default(""),
  bingSiteVerification: text("bing_site_verification").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  bankAccountTitle: text("bank_account_title").notNull().default(""),
  bankAccountNumber: text("bank_account_number").notNull().default(""),
  bankIban: text("bank_iban").notNull().default(""),
  metaPixelId: text("meta_pixel_id").notNull().default(""),
  gaMeasurementId: text("ga_measurement_id").notNull().default(""),
  freeDeliveryThreshold: integer("free_delivery_threshold").notNull().default(4000),
  codReservationHours: integer("cod_reservation_hours").notNull().default(6),
  bankReservationHours: integer("bank_reservation_hours").notNull().default(6),
  taxEnabled: boolean("tax_enabled").notNull().default(false),
  currency: text("currency").notNull().default("PKR"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const discountCodes = pgTable("discount_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  description: text("description"),
  type: text("type").notNull(), // "percentage" | "fixed"
  value: integer("value").notNull(), // percentage points (1-100) or fixed PKR amount
  minOrderAmount: integer("min_order_amount").notNull().default(0),
  maxDiscountAmount: integer("max_discount_amount"), // caps a percentage discount, nullable = uncapped
  maxRedemptions: integer("max_redemptions"), // nullable = unlimited
  redemptionCount: integer("redemption_count").notNull().default(0),
  appliesToDelivery: boolean("applies_to_delivery").notNull().default(false),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  ...timestamps,
}, (table) => [index("discount_codes_active_idx").on(table.active)]);

export const discountRedemptions = pgTable("discount_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  discountCodeId: uuid("discount_code_id").notNull().references(() => discountCodes.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull(),
  amountDiscounted: integer("amount_discounted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("discount_redemptions_code_idx").on(table.discountCodeId)]);

export const deliveryZones = pgTable("delivery_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  cities: jsonb("cities").notNull().default([]),
  provinces: jsonb("provinces").notNull().default([]),
  deliveryCharge: integer("delivery_charge").notNull(),
  estimatedDaysMin: integer("estimated_days_min").notNull().default(2),
  estimatedDaysMax: integer("estimated_days_max").notNull().default(5),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (table) => [uniqueIndex("delivery_zones_name_idx").on(table.name)]);

// A shopper's refund claim (or one the system opens when a prepaid order is cancelled). The owner reviews
// it, optionally arranges a return pickup with TCS, and finally marks it refunded with the payment
// reference. One per order.
export const refundRequests = pgTable("refund_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("customer"), // "customer" | "admin" | "system"
  reason: text("reason").notNull(),
  details: text("details"),
  amount: integer("amount").notNull(),
  payoutMethod: text("payout_method"), // "bank" | "jazzcash" | "easypaisa" | "nayapay" | "other"
  payoutAccount: text("payout_account"),
  payoutTitle: text("payout_title"),
  photoKeys: jsonb("photo_keys").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("requested"), // "requested" | "approved" | "rejected" | "refunded"
  adminNote: text("admin_note"),
  returnTrackingNumber: text("return_tracking_number"),
  refundedAmount: integer("refunded_amount"),
  refundReference: text("refund_reference"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("refund_requests_status_idx").on(table.status, table.createdAt)]);

// Owner-editable website pictures that are not products, categories or homepage banners (those have their
// own tables): see lib/site-images.ts for the list of slots and their fallbacks.
export const siteImages = pgTable("site_images", {
  slot: text("slot").primaryKey(),
  r2Key: text("r2_key").notNull(),
  altText: text("alt_text").notNull().default(""),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width"),
  height: integer("height"),
  blurDataUrl: text("blur_data_url"),
  variantWidths: jsonb("variant_widths").$type<number[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Server errors seen by the website, newest first on the developer page. Identical errors on the same day are counted, not repeated. */
export const errorLog = pgTable(
  "error_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull(),
    source: text("source").notNull(),
    message: text("message").notNull(),
    path: text("path").notNull().default(""),
    stack: text("stack").notNull().default(""),
    count: integer("count").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    day: date("day").notNull(),
  },
  (table) => [uniqueIndex("error_log_fp_day").on(table.fingerprint, table.day), index("error_log_last_idx").on(table.lastSeenAt)],
);

/** How many requests each outside service (Algolia, Groq, Resend, Geoapify, storage…) was asked for, per day (Pakistan time). */
export const apiUsage = pgTable(
  "api_usage",
  {
    service: text("service").notNull(),
    day: date("day").notNull(),
    calls: integer("calls").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    lastError: text("last_error").notNull().default(""),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.service, table.day] })],
);

/** Small cached readings (storage used per bucket, limits reported by a service's own headers). */
export const serviceStats = pgTable("service_stats", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The questions and answers on the FAQ page, edited by the owner. {{codHours}}, {{freeAbove}} and {{refundDays}} are filled in from the live settings. */
export const faqs = pgTable(
  "faqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("faqs_order_idx").on(table.sortOrder)],
);

/** Notifications and emails the owner sent from the admin "Messages" page (a short history so the same thing is not sent twice by accident). */
export const adminMessages = pgTable("admin_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // "push" | "email"
  audience: text("audience").notNull(), // "all" | "sales" | "test" | "list" | "one"
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link"),
  recipients: integer("recipients").notNull().default(0),
  delivered: integer("delivered").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
