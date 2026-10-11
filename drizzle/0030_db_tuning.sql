DROP INDEX "orders_status_idx";--> statement-breakpoint
CREATE INDEX "flash_sale_products_product_idx" ON "flash_sale_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "login_attempts_bucket_idx" ON "login_attempts" USING btree ("email","ip","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_order_idx" ON "order_idempotency_keys" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("order_status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "orders_phone_digits_idx" ON "orders" USING btree (regexp_replace("customer_phone", '\D', '', 'g'));--> statement-breakpoint
CREATE INDEX "product_collections_collection_idx" ON "product_collections" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "images_primary_idx" ON "product_images" USING btree ("product_id") WHERE "product_images"."is_primary" and "product_images"."status" = 'active';--> statement-breakpoint
CREATE INDEX "images_variant_idx" ON "product_images" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "variants_default_idx" ON "product_variants" USING btree ("product_id") WHERE "product_variants"."is_default";--> statement-breakpoint
CREATE INDEX "products_published_order_idx" ON "products" USING btree ("published_at" DESC NULLS FIRST,"created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "products"."status" = 'published';