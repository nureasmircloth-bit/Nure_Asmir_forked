ALTER TABLE "orders" ADD COLUMN "postex_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "postex_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "postex_auto_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "postex_auto_error" text;