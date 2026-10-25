ALTER TABLE "campaign_slides" ADD COLUMN "mobile_r2_key" text;--> statement-breakpoint
ALTER TABLE "campaign_slides" ADD COLUMN "mobile_content_type" text;--> statement-breakpoint
ALTER TABLE "campaign_slides" ADD COLUMN "mobile_byte_size" integer;--> statement-breakpoint
ALTER TABLE "campaign_slides" ADD COLUMN "mobile_blur_data_url" text;--> statement-breakpoint
ALTER TABLE "campaign_slides" ADD COLUMN "mobile_variant_widths" jsonb;