CREATE TABLE "api_usage" (
	"service" text NOT NULL,
	"day" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_usage_service_day_pk" PRIMARY KEY("service","day")
);
--> statement-breakpoint
CREATE TABLE "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"stack" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"day" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_stats" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "compacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "soldout_hide_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "error_log_fp_day" ON "error_log" USING btree ("fingerprint","day");--> statement-breakpoint
CREATE INDEX "error_log_last_idx" ON "error_log" USING btree ("last_seen_at");