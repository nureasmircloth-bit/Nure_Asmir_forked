ALTER TABLE `admin_audit_log` ADD `source` text;--> statement-breakpoint
ALTER TABLE `admin_audit_log` ADD `ip` text;--> statement-breakpoint
ALTER TABLE `admin_audit_log` ADD `entity_version` integer;--> statement-breakpoint
ALTER TABLE `admin_audit_log` ADD `before_json` text;--> statement-breakpoint
ALTER TABLE `admin_audit_log` ADD `after_json` text;--> statement-breakpoint
ALTER TABLE `admin_audit_log` ADD `prev_hash` text;--> statement-breakpoint
ALTER TABLE `admin_audit_log` ADD `hash` text;