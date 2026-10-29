-- The page cache remembers which tags (for example the shop's pages) were refreshed by the admin: OpenNext's D1 tag cache (open-next.config.ts) reads and writes this table.
CREATE TABLE IF NOT EXISTS `revalidations` (`tag` text NOT NULL, `revalidatedAt` integer NOT NULL, `stale` integer, `expire` integer);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `revalidations_tag_idx` ON `revalidations` (`tag`);
