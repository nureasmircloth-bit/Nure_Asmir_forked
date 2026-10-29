-- A product can name its subcategory (the Excel import has a column for it). Additive and optional: old code ignores it, nothing existing changes.
ALTER TABLE `products` ADD `subcategory` text;
