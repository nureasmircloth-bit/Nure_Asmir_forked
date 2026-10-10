/**
 * The yes/no questions the guided labs ask of the practice data (one per lab step). Plain SQL text with no database access of its own,
 * so the labs and their checks can be tested against each other without a database (see lib/lab-checks.ts for running them).
 */

/** True when a row of `alias` was not part of the starting data (so the trainee made it). */
const madeByTrainee = (table: string, alias: string) =>
  `not exists (select 1 from sandbox_baseline b, jsonb_array_elements(b.rows) e where b.table_name = '${table}' and e->>'id' = ${alias}.id::text)`;

/** True when a row of `alias` looked like this at the start: `condition` is written against the saved row `e` (a JSON object). */
const startedAs = (table: string, alias: string, condition: string) =>
  `exists (select 1 from sandbox_baseline b, jsonb_array_elements(b.rows) e where b.table_name = '${table}' and e->>'id' = ${alias}.id::text and (${condition}))`;

/** One yes/no query per step of each lab. Every query reads the practice tables only (see practiceDb). */
export const LAB_CHECKS: Record<string, string[]> = {
  "add-product": [
    `select exists (select 1 from products p where ${madeByTrainee("products", "p")}) as ok`,
    `select exists (select 1 from products p where ${madeByTrainee("products", "p")} and exists (select 1 from product_variants v where v.product_id = p.id and v.price > 0 and v.stock_quantity > 0)) as ok`,
    `select exists (select 1 from products p where ${madeByTrainee("products", "p")} and p.status = 'published' and exists (select 1 from product_variants v where v.product_id = p.id and v.price > 0 and v.stock_quantity > 0)) as ok`,
  ],
  "confirm-order": [
    `select exists (select 1 from orders o where ${startedAs("orders", "o", "e->>'order_status' = 'pending_confirmation'")} and o.order_status in ('confirmed','processing','packed','shipped','delivered')) as ok`,
    `select exists (select 1 from orders o where ${startedAs("orders", "o", "e->>'order_status' in ('pending_confirmation','confirmed','processing')")} and o.order_status in ('packed','shipped','delivered')) as ok`,
    `select exists (select 1 from orders o where ${startedAs("orders", "o", "coalesce(e->>'courier_tracking_number', '') = ''")} and coalesce(o.courier_tracking_number, '') not in ('', 'PENDING')) as ok`,
  ],
  "cancel-order": [
    `select exists (select 1 from orders o where ${startedAs("orders", "o", "e->>'order_status' in ('pending_confirmation','confirmed','processing','packed')")} and o.order_status = 'cancelled') as ok`,
    `select exists (select 1 from orders o where ${startedAs("orders", "o", "e->>'order_status' in ('pending_confirmation','confirmed','processing','packed')")} and o.order_status = 'cancelled' and o.cancelled_at is not null and coalesce(o.cancel_reason, '') <> '') as ok`,
  ],
  "flash-sale": [
    `select exists (select 1 from flash_sales f where ${madeByTrainee("flash_sales", "f")} and f.discount_value > 0) as ok`,
    `select exists (select 1 from flash_sales f where ${madeByTrainee("flash_sales", "f")} and f.discount_value > 0 and (f.applies_to_all or exists (select 1 from flash_sale_products x where x.sale_id = f.id))) as ok`,
    `select exists (select 1 from flash_sales f where ${madeByTrainee("flash_sales", "f")} and f.discount_value > 0 and f.active and f.ends_at > now() and (f.applies_to_all or exists (select 1 from flash_sale_products x where x.sale_id = f.id))) as ok`,
  ],
  "discount-code": [
    `select exists (select 1 from discount_codes c where ${madeByTrainee("discount_codes", "c")}) as ok`,
    `select exists (select 1 from discount_codes c where ${madeByTrainee("discount_codes", "c")} and c.value > 0 and c.active) as ok`,
  ],
  "answer-faq": [
    `select exists (select 1 from faqs q where ${madeByTrainee("faqs", "q")}) as ok`,
    `select exists (select 1 from faqs q where ${madeByTrainee("faqs", "q")} and length(trim(q.answer)) >= 20 and q.active) as ok`,
  ],
};
