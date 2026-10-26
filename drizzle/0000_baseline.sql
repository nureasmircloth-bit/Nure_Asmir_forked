CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`detail` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_entity_idx` ON `admin_audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `admin_messages` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`kind` text NOT NULL,
	`audience` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`link` text,
	`recipients` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_owners` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_push_devices` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`admin_email` text NOT NULL,
	`token` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`admin_email`) REFERENCES `admin_owners`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_push_devices_token_unique` ON `admin_push_devices` (`token`);--> statement-breakpoint
CREATE INDEX `admin_push_devices_email_idx` ON `admin_push_devices` (`admin_email`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`token_hash` text NOT NULL,
	`admin_email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`admin_email`) REFERENCES `admin_owners`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `admin_sessions_email_idx` ON `admin_sessions` (`admin_email`);--> statement-breakpoint
CREATE TABLE `api_usage` (
	`service` text NOT NULL,
	`day` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`last_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`service`, `day`)
);
--> statement-breakpoint
CREATE TABLE `campaign_slides` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`r2_key` text NOT NULL,
	`alt_text` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`eyebrow` text DEFAULT 'New arrivals' NOT NULL,
	`headline` text DEFAULT 'Tradition in a modern form' NOT NULL,
	`body` text DEFAULT 'Shalwar kameez, shirts, pants and accessories for the modern man.' NOT NULL,
	`cta_label` text DEFAULT 'Shop now' NOT NULL,
	`cta_href` text DEFAULT '/shop' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`blur_data_url` text,
	`variant_widths` text,
	`mobile_r2_key` text,
	`mobile_content_type` text,
	`mobile_byte_size` integer,
	`mobile_blur_data_url` text,
	`mobile_variant_widths` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_slides_r2_key_unique` ON `campaign_slides` (`r2_key`);--> statement-breakpoint
CREATE INDEX `campaign_slides_order_idx` ON `campaign_slides` (`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`subcategories` text,
	`image_r2_key` text,
	`image_alt_text` text,
	`image_content_type` text,
	`image_byte_size` integer,
	`image_blur_data_url` text,
	`image_variant_widths` text,
	`hero_r2_key` text,
	`hero_alt_text` text,
	`hero_content_type` text,
	`hero_byte_size` integer,
	`hero_blur_data_url` text,
	`hero_variant_widths` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_status_idx` ON `categories` (`status`);--> statement-breakpoint
CREATE TABLE `checkout_verifications` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`email` text NOT NULL,
	`ip` text NOT NULL,
	`otp_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`verified_token` text,
	`verified_until` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_verifications_verified_token_unique` ON `checkout_verifications` (`verified_token`);--> statement-breakpoint
CREATE INDEX `checkout_verifications_email_idx` ON `checkout_verifications` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_unique` ON `collections` (`slug`);--> statement-breakpoint
CREATE TABLE `customer_push_devices` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`token` text NOT NULL,
	`order_numbers` text DEFAULT '[]' NOT NULL,
	`wishlist` text DEFAULT '[]' NOT NULL,
	`sales_opt_in` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_push_devices_token_unique` ON `customer_push_devices` (`token`);--> statement-breakpoint
CREATE TABLE `delivery_zones` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`cities` text DEFAULT '[]' NOT NULL,
	`provinces` text DEFAULT '[]' NOT NULL,
	`delivery_charge` integer NOT NULL,
	`estimated_days_min` integer DEFAULT 2 NOT NULL,
	`estimated_days_max` integer DEFAULT 5 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_zones_name_idx` ON `delivery_zones` (`name`);--> statement-breakpoint
CREATE TABLE `discount_codes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`min_order_amount` integer DEFAULT 0 NOT NULL,
	`max_discount_amount` integer,
	`max_redemptions` integer,
	`redemption_count` integer DEFAULT 0 NOT NULL,
	`applies_to_delivery` integer DEFAULT false NOT NULL,
	`starts_at` integer,
	`expires_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discount_codes_code_unique` ON `discount_codes` (`code`);--> statement-breakpoint
CREATE INDEX `discount_codes_active_idx` ON `discount_codes` (`active`);--> statement-breakpoint
CREATE TABLE `discount_redemptions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`discount_code_id` text NOT NULL,
	`order_id` text NOT NULL,
	`amount_discounted` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`discount_code_id`) REFERENCES `discount_codes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discount_redemptions_code_idx` ON `discount_redemptions` (`discount_code_id`);--> statement-breakpoint
CREATE TABLE `error_log` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`fingerprint` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`day` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_log_fp_day` ON `error_log` (`fingerprint`,`day`);--> statement-breakpoint
CREATE INDEX `error_log_last_idx` ON `error_log` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `faqs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `faqs_order_idx` ON `faqs` (`sort_order`);--> statement-breakpoint
CREATE TABLE `flash_sale_products` (
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	PRIMARY KEY(`sale_id`, `product_id`),
	FOREIGN KEY (`sale_id`) REFERENCES `flash_sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `flash_sale_products_product_idx` ON `flash_sale_products` (`product_id`);--> statement-breakpoint
CREATE TABLE `flash_sales` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`discount_type` text NOT NULL,
	`discount_value` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`applies_to_all` integer DEFAULT false NOT NULL,
	`start_notified_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `flash_sales_window_idx` ON `flash_sales` (`active`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`variant_id` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`reason` text,
	`reference_type` text,
	`reference_id` text,
	`actor_email` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inventory_variant_idx` ON `inventory_movements` (`variant_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`email` text NOT NULL,
	`ip` text NOT NULL,
	`success` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_email_idx` ON `login_attempts` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_attempts_bucket_idx` ON `login_attempts` (`email`,`ip`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_events_sent` (
	`order_id` text NOT NULL,
	`event` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`order_id`, `event`),
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `order_idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idempotency_order_idx` ON `order_idempotency_keys` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`variant_id` text,
	`product_name` text NOT NULL,
	`variant_name` text NOT NULL,
	`sku` text NOT NULL,
	`image_url` text,
	`unit_price` integer NOT NULL,
	`quantity` integer NOT NULL,
	`line_total` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_product_idx` ON `order_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `order_items_variant_idx` ON `order_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`order_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`actor_email` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_history_order_idx` ON `order_status_history` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`order_number` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_email` text,
	`city` text NOT NULL,
	`province` text NOT NULL,
	`address` text NOT NULL,
	`delivery_latitude` real,
	`delivery_longitude` real,
	`delivery_notes` text,
	`subtotal` integer NOT NULL,
	`delivery_charge` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`tax` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`currency` text DEFAULT 'PKR' NOT NULL,
	`payment_method` text NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`order_status` text DEFAULT 'pending_confirmation' NOT NULL,
	`reservation_expires_at` integer,
	`reminder_sent_at` integer,
	`notes` text,
	`whatsapp_message_id` text,
	`estimated_delivery_date` text,
	`courier_name` text DEFAULT 'TCS' NOT NULL,
	`courier_tracking_number` text,
	`courier_booked_at` integer,
	`courier_status` text,
	`courier_synced_at` integer,
	`courier_auto_attempts` integer DEFAULT 0 NOT NULL,
	`courier_auto_error` text,
	`handed_over_at` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`cancelled_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `orders_phone_idx` ON `orders` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `orders_status_created_idx` ON `orders` (`order_status`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE TABLE `payment_proofs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`order_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_proofs_r2_key_unique` ON `payment_proofs` (`r2_key`);--> statement-breakpoint
CREATE INDEX `payment_proofs_order_idx` ON `payment_proofs` (`order_id`);--> statement-breakpoint
CREATE TABLE `product_collections` (
	`product_id` text NOT NULL,
	`collection_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `collection_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_collections_collection_idx` ON `product_collections` (`collection_id`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`r2_key` text NOT NULL,
	`alt_text` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`focal_point_x` integer DEFAULT 50 NOT NULL,
	`focal_point_y` integer DEFAULT 50 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`blur_data_url` text,
	`variant_widths` text,
	`compacted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_images_r2_key_unique` ON `product_images` (`r2_key`);--> statement-breakpoint
CREATE INDEX `images_product_idx` ON `product_images` (`product_id`);--> statement-breakpoint
CREATE INDEX `images_primary_idx` ON `product_images` (`product_id`) WHERE "product_images"."is_primary" and "product_images"."status" = 'active';--> statement-breakpoint
CREATE INDEX `images_variant_idx` ON `product_images` (`variant_id`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`color` text NOT NULL,
	`size` text,
	`fabric` text,
	`gtin` text,
	`price` integer NOT NULL,
	`compare_at_price` integer,
	`currency` text DEFAULT 'PKR' NOT NULL,
	`stock_quantity` integer DEFAULT 0 NOT NULL,
	`reserved_quantity` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 3 NOT NULL,
	`stock_alert_state` text DEFAULT 'ok' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE INDEX `variants_stock_idx` ON `product_variants` (`stock_quantity`);--> statement-breakpoint
CREATE INDEX `variants_default_idx` ON `product_variants` (`product_id`) WHERE "product_variants"."is_default";--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`type_label` text NOT NULL,
	`short_description` text,
	`description` text,
	`material` text,
	`dimensions` text,
	`care_instructions` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`price_on_request` integer DEFAULT false NOT NULL,
	`fulfilment` text DEFAULT 'ready' NOT NULL,
	`badge` text,
	`seo_title` text,
	`seo_description` text,
	`seo_keywords` text,
	`seo_locked` integer DEFAULT false NOT NULL,
	`pattern` text,
	`primary_colour` text,
	`occasion` text,
	`style` text,
	`country_of_origin` text,
	`gender` text DEFAULT 'male' NOT NULL,
	`google_product_category` text,
	`published_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`);--> statement-breakpoint
CREATE INDEX `products_featured_idx` ON `products` (`featured`);--> statement-breakpoint
CREATE INDEX `products_published_order_idx` ON `products` ("published_at" desc,"created_at" desc,"id" desc) WHERE "products"."status" = 'published';--> statement-breakpoint
CREATE TABLE `refund_requests` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`order_id` text NOT NULL,
	`source` text DEFAULT 'customer' NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`amount` integer NOT NULL,
	`payout_method` text,
	`payout_account` text,
	`payout_title` text,
	`photo_keys` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`admin_note` text,
	`return_tracking_number` text,
	`refunded_amount` integer,
	`refund_reference` text,
	`refunded_at` integer,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refund_requests_order_id_unique` ON `refund_requests` (`order_id`);--> statement-breakpoint
CREATE INDEX `refund_requests_status_idx` ON `refund_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `sandbox_baseline` (
	`table_name` text PRIMARY KEY NOT NULL,
	`rows` text NOT NULL,
	`captured_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sandbox_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_stats` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_images` (
	`slot` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`blur_data_url` text,
	`variant_widths` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` text PRIMARY KEY DEFAULT 'store' NOT NULL,
	`brand_name` text DEFAULT 'Nure Asmir' NOT NULL,
	`whatsapp_number` text DEFAULT '' NOT NULL,
	`support_phone` text DEFAULT '' NOT NULL,
	`support_email` text DEFAULT '' NOT NULL,
	`instagram_url` text DEFAULT '' NOT NULL,
	`facebook_url` text DEFAULT '' NOT NULL,
	`tiktok_url` text DEFAULT '' NOT NULL,
	`whatsapp_chat_url` text DEFAULT '' NOT NULL,
	`tcs_shipper_name` text DEFAULT 'Nure Asmir' NOT NULL,
	`tcs_shipper_address` text DEFAULT '' NOT NULL,
	`tcs_shipper_city_name` text DEFAULT 'Karachi' NOT NULL,
	`tcs_shipper_city_code` text DEFAULT 'KHI' NOT NULL,
	`tcs_shipper_phone` text DEFAULT '' NOT NULL,
	`refund_window_days` integer DEFAULT 7 NOT NULL,
	`soldout_hide_days` integer DEFAULT 90 NOT NULL,
	`announcement_mode` text DEFAULT 'auto' NOT NULL,
	`announcement_lines` text DEFAULT '' NOT NULL,
	`announcement_style` text DEFAULT 'rotate' NOT NULL,
	`about_heading` text DEFAULT '' NOT NULL,
	`about_body` text DEFAULT '' NOT NULL,
	`bank_deposit_enabled` integer DEFAULT false NOT NULL,
	`delivery_mode` text DEFAULT 'zones' NOT NULL,
	`flat_delivery_charge` integer DEFAULT 250 NOT NULL,
	`google_site_verification` text DEFAULT '' NOT NULL,
	`bing_site_verification` text DEFAULT '' NOT NULL,
	`bank_name` text DEFAULT '' NOT NULL,
	`bank_account_title` text DEFAULT '' NOT NULL,
	`bank_account_number` text DEFAULT '' NOT NULL,
	`bank_iban` text DEFAULT '' NOT NULL,
	`meta_pixel_id` text DEFAULT '' NOT NULL,
	`ga_measurement_id` text DEFAULT '' NOT NULL,
	`free_delivery_threshold` integer DEFAULT 4000 NOT NULL,
	`cod_reservation_hours` integer DEFAULT 6 NOT NULL,
	`bank_reservation_hours` integer DEFAULT 6 NOT NULL,
	`tax_enabled` integer DEFAULT false NOT NULL,
	`currency` text DEFAULT 'PKR' NOT NULL,
	`theme_accent_color` text DEFAULT '#c5a059' NOT NULL,
	`theme_preset` text DEFAULT 'signature' NOT NULL,
	`theme_background_color` text DEFAULT '#ffffff' NOT NULL,
	`theme_text_color` text DEFAULT '#111111' NOT NULL,
	`theme_surface_color` text DEFAULT '#faf9f6' NOT NULL,
	`theme_radius` text DEFAULT 'subtle' NOT NULL,
	`font_family` text DEFAULT 'Cormorant Garamond' NOT NULL,
	`body_font_family` text DEFAULT 'Jost' NOT NULL,
	`contact_font_family` text DEFAULT 'Inter' NOT NULL,
	`shop_description` text DEFAULT '' NOT NULL,
	`newsletter_title` text DEFAULT '' NOT NULL,
	`newsletter_text` text DEFAULT '' NOT NULL,
	`ready_delivery_text` text DEFAULT '' NOT NULL,
	`bespoke_delivery_text` text DEFAULT '' NOT NULL,
	`theme_bottom_bar_color` text DEFAULT '' NOT NULL,
	`theme_bottom_bar_text_color` text DEFAULT '' NOT NULL,
	`theme_header_color` text DEFAULT '' NOT NULL,
	`theme_header_text_color` text DEFAULT '' NOT NULL,
	`theme_sidebar_color` text DEFAULT '' NOT NULL,
	`theme_sidebar_text_color` text DEFAULT '' NOT NULL,
	`theme_footer_color` text DEFAULT '' NOT NULL,
	`theme_footer_text_color` text DEFAULT '' NOT NULL,
	`theme_currency_color` text DEFAULT '' NOT NULL,
	`theme_currency_text_color` text DEFAULT '' NOT NULL,
	`pending_changes` text,
	`pending_apply_at` integer,
	`previous_settings` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store_locations` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`hours` text DEFAULT '' NOT NULL,
	`latitude` real,
	`longitude` real,
	`is_main` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscribers` (
	`email` text PRIMARY KEY NOT NULL,
	`first_name` text,
	`source` text DEFAULT 'website' NOT NULL,
	`status` text DEFAULT 'subscribed' NOT NULL,
	`consent_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
