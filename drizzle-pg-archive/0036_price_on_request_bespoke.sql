ALTER TABLE "products" ADD COLUMN "price_on_request" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "fulfilment" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "ready_delivery_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "bespoke_delivery_text" text DEFAULT '' NOT NULL;