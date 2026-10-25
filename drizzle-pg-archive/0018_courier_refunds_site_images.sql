CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"source" text DEFAULT 'customer' NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"amount" integer NOT NULL,
	"payout_method" text,
	"payout_account" text,
	"payout_title" text,
	"photo_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"admin_note" text,
	"return_tracking_number" text,
	"refunded_amount" integer,
	"refund_reference" text,
	"refunded_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_requests_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "site_images" (
	"slot" text PRIMARY KEY NOT NULL,
	"r2_key" text NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"blur_data_url" text,
	"variant_widths" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- PostEx is replaced by TCS: keep any existing booking data by renaming, not dropping.
ALTER TABLE "orders" RENAME COLUMN "postex_tracking_number" TO "courier_tracking_number";--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "postex_booked_at" TO "courier_booked_at";--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "postex_status" TO "courier_status";--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "postex_synced_at" TO "courier_synced_at";--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "postex_auto_attempts" TO "courier_auto_attempts";--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "postex_auto_error" TO "courier_auto_error";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "courier_name" text DEFAULT 'TCS' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "facebook_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "tiktok_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "whatsapp_chat_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "tcs_shipper_name" text DEFAULT 'Nure Asmir' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "tcs_shipper_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "tcs_shipper_city_name" text DEFAULT 'Karachi' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "tcs_shipper_city_code" text DEFAULT 'KHI' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "tcs_shipper_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "refund_window_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_requests_status_idx" ON "refund_requests" USING btree ("status","created_at");
--> statement-breakpoint
-- Brand contact details and social profiles (only fill what the owner has not already set).
INSERT INTO "site_settings" ("id") VALUES ('store') ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "site_settings" SET
  "support_phone" = CASE WHEN "support_phone" = '' THEN '+923116111963' ELSE "support_phone" END,
  "whatsapp_number" = CASE WHEN "whatsapp_number" = '' THEN '+923116111963' ELSE "whatsapp_number" END,
  "tcs_shipper_phone" = CASE WHEN "tcs_shipper_phone" = '' THEN '03116111963' ELSE "tcs_shipper_phone" END,
  "instagram_url" = CASE WHEN "instagram_url" = '' THEN 'https://www.instagram.com/nureasmirofficial' ELSE "instagram_url" END,
  "facebook_url" = CASE WHEN "facebook_url" = '' THEN 'https://www.facebook.com/share/1BYdatPDfZ/' ELSE "facebook_url" END,
  "tiktok_url" = CASE WHEN "tiktok_url" = '' THEN 'https://www.tiktok.com/@nure.asmir' ELSE "tiktok_url" END,
  "whatsapp_chat_url" = CASE WHEN "whatsapp_chat_url" = '' THEN 'https://wa.me/message/BW72H342EHB3E1' ELSE "whatsapp_chat_url" END
WHERE "id" = 'store';
