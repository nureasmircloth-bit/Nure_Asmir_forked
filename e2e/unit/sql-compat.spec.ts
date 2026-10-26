import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { sql, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyMigrations } from "../../scripts/local-db.mjs";
import { chunked, D1_MAX_PARAMS, greatest, jsonArrayHas, likeEsc, phoneDigits } from "../../db/sql-compat";
import { isUniqueViolation } from "../../lib/db/errors";

const dialect = new SQLiteSyncDialect();
/** Runs a drizzle sql fragment as `select <fragment> as v` against an in-memory SQLite and returns v. */
function value(fragment: SQL): unknown {
  const { sql: text, params } = dialect.sqlToQuery(sql`select ${fragment} as v`);
  const db = new Database(":memory:");
  try {
    return (db.prepare(text).get(...params) as { v: unknown }).v;
  } finally {
    db.close();
  }
}

test.describe("SQL helpers for the D1 (SQLite) database", () => {
  test("phone numbers are compared by their digits, however they were typed", () => {
    for (const typed of ["0300-1234567", "+92 300 1234567".replace("+92 ", "0"), "(0300) 123.4567"]) expect(value(phoneDigits(sql`${typed}`))).toBe("03001234567");
  });

  test("a JSON list is searched for one text value", () => {
    expect(value(jsonArrayHas(sql`${'["NA-1001","NA-1002"]'}`, "NA-1002"))).toBe(1);
    expect(value(jsonArrayHas(sql`${'["NA-1001"]'}`, "NA-1002"))).toBe(0);
    expect(value(jsonArrayHas(sql`${"[]"}`, "NA-1002"))).toBe(0);
  });

  test("greatest picks the larger value, and 0 floors a negative", () => {
    expect(value(greatest(0, -4))).toBe(0);
    expect(value(greatest(3, 9, 5))).toBe(9);
  });

  test("a typed % or _ in a search is taken literally", () => {
    expect(value(likeEsc(sql`${"Sale 50% off"}`, "%50\\%%"))).toBe(1);
    expect(value(likeEsc(sql`${"Sale 500 off"}`, "%50\\%%"))).toBe(0);
    expect(value(likeEsc(sql`${"IVORY tee"}`, "%ivory%"))).toBe(1); // letters ignore case
  });

  test("long lists are split to fit the 100-value limit of one D1 statement", () => {
    const parts = chunked(Array.from({ length: 250 }, (_, i) => i));
    expect(parts.map((part) => part.length)).toEqual([D1_MAX_PARAMS, D1_MAX_PARAMS, 250 - 2 * D1_MAX_PARAMS]);
    expect(parts.flat()).toHaveLength(250);
    expect(chunked([])).toEqual([]);
  });

  test("a duplicate key is recognised, also when the driver's error is wrapped", () => {
    const inner = Object.assign(new Error("UNIQUE constraint failed: products.slug"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
    expect(isUniqueViolation(inner)).toBe(true);
    expect(isUniqueViolation(new Error("Failed query: insert ...", { cause: new Error("D1_ERROR: UNIQUE constraint failed: product_variants.sku: SQLITE_CONSTRAINT") }))).toBe(true);
    expect(isUniqueViolation(new Error("something else"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

test.describe("the migrations", () => {
  test("build the whole database from nothing, with the rows every new shop starts with", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "na-db-")), "t.sqlite");
    const applied = applyMigrations(file, { reset: true });
    expect(applied).toBeGreaterThanOrEqual(4);
    const db = new Database(file);
    try {
      const tables = (db.prepare("select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\'").all() as Array<{ name: string }>).map((row) => row.name);
      for (const name of ["products", "product_variants", "orders", "order_items", "site_settings", "flash_sales", "faqs", "admin_owners"]) expect(tables).toContain(name);
      expect((db.prepare("select count(*) as n from site_settings where id = 'store'").get() as { n: number }).n).toBe(1);
      expect((db.prepare("select count(*) as n from faqs").get() as { n: number }).n).toBeGreaterThanOrEqual(7);
      // ids and times are made by the database itself, so hand-written inserts need not supply them
      db.prepare("insert into admin_owners (email, password_hash) values ('a@b.c', 'x')").run();
      db.prepare("insert into admin_sessions (token_hash, admin_email, expires_at) values ('t', 'a@b.c', 1)").run();
      const row = db.prepare("select id, created_at from admin_sessions").get() as { id: string; created_at: number };
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Math.abs(row.created_at - Date.now())).toBeLessThan(5000);
      // applying again does nothing
      expect(applyMigrations(file)).toBe(0);
    } finally {
      db.close();
    }
  });
});
