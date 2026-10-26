ALTER TABLE "orders" ADD COLUMN "postex_tracking_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "postex_booked_at" timestamp with time zone;