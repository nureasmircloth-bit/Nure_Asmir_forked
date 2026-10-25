-- Rows every new shop starts with (they were inserted by the old Postgres migrations 0018, 0020 and 0023).
--> statement-breakpoint
INSERT INTO "site_settings" ("id") VALUES ('store') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "site_settings" SET
  "support_phone" = CASE WHEN "support_phone" = '' THEN '+923116111963' ELSE "support_phone" END,
  "whatsapp_number" = CASE WHEN "whatsapp_number" = '' THEN '+923116111963' ELSE "whatsapp_number" END,
  "tcs_shipper_phone" = CASE WHEN "tcs_shipper_phone" = '' THEN '03116111963' ELSE "tcs_shipper_phone" END,
  "instagram_url" = CASE WHEN "instagram_url" = '' THEN 'https://www.instagram.com/nureasmirofficial' ELSE "instagram_url" END,
  "facebook_url" = CASE WHEN "facebook_url" = '' THEN 'https://www.facebook.com/share/1BYdatPDfZ/' ELSE "facebook_url" END,
  "tiktok_url" = CASE WHEN "tiktok_url" = '' THEN 'https://www.tiktok.com/@nure.asmir' ELSE "tiktok_url" END,
  "whatsapp_chat_url" = CASE WHEN "whatsapp_chat_url" = '' THEN 'https://wa.me/message/BW72H342EHB3E1' ELSE "whatsapp_chat_url" END
WHERE "id" = 'store';
--> statement-breakpoint
INSERT INTO "store_locations" ("name", "address", "city", "phone", "is_main", "sort_order") VALUES ('Nure Asmir – Mall of Lahore', '13-F & 13-G, Park Lane Tower, Mall of Lahore, Tufail Road, Cantt', 'Lahore', '+923116111963', true, 0);
--> statement-breakpoint
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
