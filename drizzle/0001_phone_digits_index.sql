-- Customers type phones as 0300..., +92300... or 92300...: reports and searches compare the digits only (db/sql-compat.ts phoneDigits),
-- and this index matches that exact expression.
CREATE INDEX `orders_phone_digits_idx` ON `orders` (replace(replace(replace(replace(replace(replace(`customer_phone`, ' ', ''), '+', ''), '-', ''), '(', ''), ')', ''), '.', ''));
