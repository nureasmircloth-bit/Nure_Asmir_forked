ALTER TABLE "site_settings" ADD COLUMN "announcement_style" text DEFAULT 'rotate' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "about_heading" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "about_body" text DEFAULT '' NOT NULL;