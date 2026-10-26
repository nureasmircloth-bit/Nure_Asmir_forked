ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;