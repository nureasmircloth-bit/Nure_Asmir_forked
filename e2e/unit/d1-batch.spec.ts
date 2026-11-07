import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { batchOnD1, BATCH_SIZE, type BatchBinding } from "../../db/d1-batch";

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

  test("a long list goes in consecutive batches", async () => {
    const { binding, batches } = fakeBinding();
    await batchOnD1(binding, Array.from({ length: BATCH_SIZE * 2 + 5 }, (_, i) => sql`insert into t (n) values (${i})`));
    expect(batches.map((batch) => batch.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 5]);
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
