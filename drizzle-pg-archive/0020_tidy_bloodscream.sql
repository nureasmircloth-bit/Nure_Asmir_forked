CREATE TABLE "store_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"hours" text DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"is_main" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "store_locations" ("name", "address", "city", "phone", "is_main", "sort_order") VALUES ('Nure Asmir – Mall of Lahore', '13-F & 13-G, Park Lane Tower, Mall of Lahore, Tufail Road, Cantt', 'Lahore', '+923116111963', true, 0);
