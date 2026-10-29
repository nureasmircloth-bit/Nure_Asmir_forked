-- "Coming soon" products: shown with a name, a picture and a badge, but cannot be bought yet. Additive; existing products are unchanged (0 = not coming soon).
ALTER TABLE `products` ADD `coming_soon` integer DEFAULT 0 NOT NULL;
