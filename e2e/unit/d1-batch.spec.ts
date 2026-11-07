import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { batchOnD1, MAX_ATOMIC_STATEMENTS, type BatchBinding } from "../../db/d1-batch";

/** A stand-in for the D1 binding that records what it is given. */
function fakeBinding() {
  const prepared: Array<{ text: string; values: unknown[] }> = [];
  const batches: unknown[][] = [];
  const binding: BatchBinding = {
    prepare: (text) => ({ bind: (...values) => { const statement = { text, values }; prepared.push(statement); return statement; } }),
    batch: async (statements) => { batches.push(statements); },
  };
  return { binding, prepared, batches };
}

test.describe("grouped writes on Cloudflare D1", () => {
  test("each statement is sent as prepared text with its values, in one batch", async () => {
    const { binding, prepared, batches } = fakeBinding();
    await batchOnD1(binding, [
      sql`insert into mcp_tokens (id, label) select ${"a1"}, ${"Claude"} where (select count(*) from mcp_tokens) < ${10}`,
      sql`insert into admin_audit_log (actor_email, action) select ${"o@x"}, 'mcp.token.create' where exists (select 1 from mcp_tokens where id = ${"a1"})`,
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(prepared[0].text).toMatch(/^insert into mcp_tokens \(id, label\) select \?, \? where/);
    expect(prepared[0].values).toEqual(["a1", "Claude", 10]);
    expect(prepared[1].values).toEqual(["o@x", "a1"]);
    // every item in the batch is a prepared statement (this is what the old code got wrong: it passed drizzle's own run() objects)
    expect(batches[0]).toEqual(prepared);
  });

  test("a long list is still ONE batch, in the order it was given (a restore deletes before it inserts)", async () => {
    const { binding, batches } = fakeBinding();
    const count = 450;
    await batchOnD1(binding, Array.from({ length: count }, (_, i) => (i < 150 ? sql`delete from t where n = ${i}` : sql`insert into t (n) values (${i})`)));
    expect(batches).toHaveLength(1); // one batch is the only all-or-nothing unit D1 has
    const sent = batches[0] as Array<{ text: string; values: unknown[] }>;
    expect(sent.map((statement) => statement.values[0])).toEqual(Array.from({ length: count }, (_, i) => i));
    expect(sent.slice(0, 150).every((statement) => statement.text.startsWith("delete"))).toBe(true);
    expect(sent.slice(150).every((statement) => statement.text.startsWith("insert"))).toBe(true);
  });

  test("a list longer than the most one group may hold is refused before anything is sent", async () => {
    const { binding, prepared, batches } = fakeBinding();
    await expect(batchOnD1(binding, Array.from({ length: MAX_ATOMIC_STATEMENTS + 1 }, (_, i) => sql`insert into t (n) values (${i})`))).rejects.toThrow(/Nothing was changed/);
    expect(batches).toHaveLength(0);
    expect(prepared).toHaveLength(0);
    await batchOnD1(binding, Array.from({ length: MAX_ATOMIC_STATEMENTS }, (_, i) => sql`insert into t (n) values (${i})`)); // exactly the most is fine
    expect(batches).toHaveLength(1);
  });

  test("a failing batch is passed on, never swallowed", async () => {
    const binding: BatchBinding = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error("D1_ERROR: no such table"); } };
    await expect(batchOnD1(binding, [sql`insert into nope values (1)`])).rejects.toThrow(/no such table/);
  });

  test("nothing to run sends nothing", async () => {
    const { binding, batches } = fakeBinding();
    await batchOnD1(binding, []);
    expect(batches).toHaveLength(0);
  });
});
