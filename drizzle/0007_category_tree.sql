-- Categories can sit inside other categories (Shirts > Formal Shirts > Business Formal Shirts). Additive and optional: an empty parent_id is a top-level
-- category, exactly what every existing row is, so nothing existing changes.
ALTER TABLE `categories` ADD `parent_id` text REFERENCES categories(id);
--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);
