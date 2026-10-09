CREATE TABLE "sandbox_baseline" (
	"table_name" text PRIMARY KEY NOT NULL,
	"rows" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_usage" (
	"day" text PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
