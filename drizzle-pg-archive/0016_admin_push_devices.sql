CREATE TABLE "admin_push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_email" text NOT NULL,
	"token" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "admin_push_devices" ADD CONSTRAINT "admin_push_devices_admin_email_admin_owners_email_fk" FOREIGN KEY ("admin_email") REFERENCES "public"."admin_owners"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_push_devices_email_idx" ON "admin_push_devices" USING btree ("admin_email");