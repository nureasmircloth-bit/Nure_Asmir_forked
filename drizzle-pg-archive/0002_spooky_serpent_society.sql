ALTER TABLE "campaign_slides" ADD COLUMN "blur_data_url" text;--> statement-breakpoint
ALTER TABLE "campaign_slides" ADD COLUMN "variant_widths" jsonb;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "blur_data_url" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "variant_widths" jsonb;