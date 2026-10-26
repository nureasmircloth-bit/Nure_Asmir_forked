ALTER TABLE "categories" ADD COLUMN "image_r2_key" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_alt_text" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_content_type" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_byte_size" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_blur_data_url" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_variant_widths" jsonb;