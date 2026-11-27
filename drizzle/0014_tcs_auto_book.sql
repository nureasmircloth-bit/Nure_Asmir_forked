ALTER TABLE `orders` ADD `is_international` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `tcs_auto_book` integer DEFAULT false NOT NULL;