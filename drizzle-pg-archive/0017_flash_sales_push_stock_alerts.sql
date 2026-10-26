CREATE TABLE "customer_push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"order_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wishlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sales_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "flash_sale_products" (
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "flash_sale_products_sale_id_product_id_pk" PRIMARY KEY("sale_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "flash_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"applies_to_all" boolean DEFAULT false NOT NULL,
	"start_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events_sent" (
	"order_id" uuid NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_sent_order_id_event_pk" PRIMARY KEY("order_id","event")
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "stock_alert_state" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "flash_sale_products" ADD CONSTRAINT "flash_sale_products_sale_id_flash_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."flash_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flash_sale_products" ADD CONSTRAINT "flash_sale_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events_sent" ADD CONSTRAINT "order_events_sent_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flash_sales_window_idx" ON "flash_sales" USING btree ("active","starts_at","ends_at");