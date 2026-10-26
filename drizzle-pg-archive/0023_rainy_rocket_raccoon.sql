CREATE TABLE "faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "announcement_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "announcement_lines" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "bank_deposit_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "delivery_mode" text DEFAULT 'zones' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "flat_delivery_charge" integer DEFAULT 250 NOT NULL;--> statement-breakpoint
CREATE INDEX "faqs_order_idx" ON "faqs" USING btree ("sort_order");--> statement-breakpoint
UPDATE "site_settings" SET "support_email" = 'support@nureasmir.com' WHERE "support_email" = '';
--> statement-breakpoint
INSERT INTO "faqs" ("question", "answer", "sort_order") VALUES
('Do you offer cash on delivery?', 'Yes. Cash on delivery is available all over Pakistan. Once you place an order we hold your stock for {{codHours}} hours while we confirm it with you.', 0),
('How much is delivery, and is it ever free?', 'The delivery charge for your area is shown at checkout before you place your order. Delivery is free on orders of Rs. {{freeAbove}} or more.', 1),
('How long does delivery take?', 'Most orders arrive within 2–5 working days of confirmation, depending on your area — the estimate for your address is shown at checkout. Remote areas may take a little longer.', 2),
('How do I know which size or fit to choose?', 'Choose your size on each product page — sizes that are out of stock are crossed out. If you are between sizes or unsure about the fit, message us on WhatsApp before ordering and we will help you choose.', 3),
('What if I need to return or exchange something?', 'We offer returns and exchanges under our Returns policy — inspect your parcel promptly and contact us within 48 hours if anything arrives damaged, incomplete, or different from what you ordered. Refunds can be requested within {{refundDays}} days of delivery.', 4),
('How do I track my order?', 'Use the Track your order page with your order number and phone number to see its current status at any time.', 5),
('How can I reach you with a question before ordering?', 'Message us on WhatsApp or through the Contact page — a person, not a script, will answer.', 6);
