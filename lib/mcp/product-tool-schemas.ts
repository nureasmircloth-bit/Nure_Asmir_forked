// What the product tools accept. Pure (no database), so a unit test can check the real schemas: a missing limit here is a bug the test must catch.

import { ROWS_SCHEMA } from "@/lib/import/sheet-rows";
import { SHEET_COLUMNS } from "@/lib/product-sheet";

/** What one row looks like, written for the assistant. */
export const ROW_HELP =
  "One object for each COLOUR of a product (or for each size; both work and can be mixed), written like the owner's Excel sheet. Keys: " +
  SHEET_COLUMNS.map((column) => `${column.key}${column.required ? "*" : ""}`).join(", ") +
  ". Examples: sizes as one text with commas (\"14.5, 15.5, 16.5\") or a list; price, oldPrice and stock as ONE number for every size or one for each size in the same order (\"5800, 5800, 6200\"); " +
  "code is the owner's own article number (each size then gets its own code made from it); photos are the picture FILE NAMES the owner will drop later (\"white-1.jpg, white-2.jpg\"); " +
  "show is Yes/No. Another colour of the same product is another row with the same name and a different colour.";

/** The rows argument, with its limit. */
export const ROWS_PROPERTY = { ...ROWS_SCHEMA, description: ROW_HELP };

/** The arguments of prepare_products. */
export const PREPARE_INPUT = { type: "object", properties: { rows: ROWS_PROPERTY }, required: ["rows"], additionalProperties: false } as const;

/** The arguments of create_products: the same rows, and the confirmation prepare_products gave. */
export const CREATE_INPUT = {
  type: "object",
  properties: { rows: ROWS_PROPERTY, confirm: { type: "string", description: "The confirmation prepare_products gave for these exact rows (it is used up by one create_products call)." } },
  required: ["rows", "confirm"],
  additionalProperties: false,
} as const;

/** The arguments of products_waiting_for_pictures. */
export const WAITING_INPUT = {
  type: "object",
  properties: { page: { type: "integer", minimum: 1, maximum: 1000, description: "Which page of products (20 on a page). Default 1. The answer says when there is a next page." } },
  additionalProperties: false,
} as const;
