CREATE TABLE "checkout_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_token" text,
	"verified_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_verifications_verified_token_unique" UNIQUE("verified_token")
);
--> statement-breakpoint
ALTER TABLE "site_settings" ALTER COLUMN "cod_reservation_hours" SET DEFAULT 6;--> statement-breakpoint
ALTER TABLE "site_settings" ALTER COLUMN "bank_reservation_hours" SET DEFAULT 6;--> statement-breakpoint
CREATE INDEX "checkout_verifications_email_idx" ON "checkout_verifications" USING btree ("email","created_at");