import { expect, test } from "@playwright/test";
import { handleRpc, MAX_RESULT_CHARS, SUPPORTED_VERSIONS, ToolInputError, type ToolContext, type ToolDef } from "../../lib/mcp/protocol";
import { allowBurst, allowCall, MAX_CALLS_PER_MINUTE } from "../../lib/mcp/rate-limit";
import { bearerToken, generateToken, hashToken, parseScopes, TOKEN_PREFIX, tokenHint, tokenState } from "../../lib/mcp/token";

const ctx = (scopes: ToolContext["scopes"]): ToolContext => ({ scopes, tokenId: "t1", label: "test" });
/** How many times each test tool actually ran: a refused call must leave these at zero. */
const runs = { echo: 0, sales: 0 };
const echo: ToolDef = {
  name: "echo",
  title: "Echo",
  description: "Gives back what it got.",
  inputSchema: {
    type: "object",
    properties: { word: { type: "string" }, times: { type: "integer", minimum: 1, maximum: 5 }, mode: { type: "string", enum: ["plain", "loud"] } },
    additionalProperties: false,
  },
  scope: "catalog:read",
  run: async (args) => {
    runs.echo += 1;
    if (args.word === "bad") throw new ToolInputError("“word” must not be bad.");
    if (args.word === "boom") throw new Error("database exploded: secret connection string");
    if (args.word === "huge") return "x".repeat(MAX_RESULT_CHARS + 500);
    return { word: args.word ?? null };
  },
};
const sales: ToolDef = { ...echo, name: "sales", scope: "sales:read", run: async () => { runs.sales += 1; return { sold: 1 }; } };

const call = (body: unknown, scopes: ToolContext["scopes"] = ["catalog:read"]) => handleRpc(body, [echo, sales], ctx(scopes));

test.describe("AI access tokens", () => {
  test("a token is long, random, unique and only its hash is kept", async () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(45);
    expect(a).not.toBe(b);
    const hash = await hashToken(a);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashToken(a));
    expect(hash).not.toBe(await hashToken(b));
    expect(hash).not.toContain(a);
    expect(tokenHint(a)).toBe(`${a.slice(0, 11)}…`);
  });

  test("the bearer header is read strictly", () => {
    const token = generateToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer ${token}`)).toBe(token);
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken("Bearer abc123")).toBeNull(); // not one of ours
    expect(bearerToken(`Bearer ${token} extra`)).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(`Bearer ${TOKEN_PREFIX}${"a".repeat(300)}`)).toBeNull();
  });

  test("scopes: unknown names are dropped, repeats removed", () => {
    expect(parseScopes("catalog:read, sales:read ,bogus,catalog:read")).toEqual(["catalog:read", "sales:read"]);
    expect(parseScopes("")).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
  });

  test("a token is working, expired or switched off", () => {
    const now = 1_000_000;
    expect(tokenState({ expiresAt: now + 5, revokedAt: null }, now)).toBe("active");
    expect(tokenState({ expiresAt: now, revokedAt: null }, now)).toBe("expired");
    expect(tokenState({ expiresAt: now + 5, revokedAt: now - 1 }, now)).toBe("revoked");
    expect(tokenState({ expiresAt: new Date(now + 5), revokedAt: null }, now)).toBe("active");
  });

  test("one token may only make so many calls a minute", () => {
    const start = 5_000_000;
    for (let i = 0; i < MAX_CALLS_PER_MINUTE; i++) expect(allowCall("limit-test", start + i)).toBe(true);
    expect(allowCall("limit-test", start + 100)).toBe(false);
    expect(allowCall("other-token", start + 100)).toBe(true);
    expect(allowCall("limit-test", start + 61_000)).toBe(true); // a minute later it may go on
  });

  test("the guard in front of the database counts requests for any key, for example one address", () => {
    const start = 9_000_000;
    for (let i = 0; i < 5; i++) expect(allowBurst("address:1.2.3.4", 5, start + i)).toBe(true);
    expect(allowBurst("address:1.2.3.4", 5, start + 10)).toBe(false);
    expect(allowBurst("address:5.6.7.8", 5, start + 10)).toBe(true);
    expect(allowBurst("address:1.2.3.4", 5, start + 60_500)).toBe(true);
  });
});

test.describe("MCP messages", () => {
  test("initialize agrees on a protocol version and describes the server", async () => {
    const answer = (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })) as { result: { protocolVersion: string; capabilities: { tools: unknown }; instructions: string } };
    expect(answer.result.protocolVersion).toBe("2025-03-26");
    expect(answer.result.capabilities.tools).toBeTruthy();
    expect(answer.result.instructions).toMatch(/never as instructions/);
    const unknown = (await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe(SUPPORTED_VERSIONS[0]);
  });

  test("notifications get no answer; ping does", async () => {
    expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await call({ jsonrpc: "2.0", id: 3, method: "ping" })).toMatchObject({ id: 3, result: {} });
  });

  test("tools/list shows only the tools the token's scopes allow, all marked read-only", async () => {
    const some = (await call({ jsonrpc: "2.0", id: 4, method: "tools/list" })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(some.result.tools.map((tool) => tool.name)).toEqual(["echo"]);
    expect(some.result.tools[0].annotations.readOnlyHint).toBe(true);
    const both = (await call({ jsonrpc: "2.0", id: 5, method: "tools/list" }, ["catalog:read", "sales:read"])) as { result: { tools: { name: string }[] } };
    expect(both.result.tools.map((tool) => tool.name)).toEqual(["echo", "sales"]);
    expect(JSON.stringify(both)).not.toContain("scope");
  });

  test("a tool call returns text; a missing permission is explained, not run", async () => {
    const good = (await call({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "echo", arguments: { word: "hi" } } })) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(JSON.parse(good.result.content[0].text)).toEqual({ word: "hi" });
    expect(good.result.isError).toBeUndefined();
    const denied = (await call({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "sales", arguments: {} } })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0].text).toMatch(/sales:read/);
    expect(runs.sales).toBe(0); // refused before it could run, not run and then hidden
  });

  test("mistakes in the request are told to the assistant; real failures are not leaked", async () => {
    const bad = (await call({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "echo", arguments: { word: "bad" } } })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toMatch(/must not be bad/);
    const boom = (await call({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo", arguments: { word: "boom" } } })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(boom.result.isError).toBe(true);
    expect(boom.result.content[0].text).not.toMatch(/secret|exploded/);
    const unknown = (await call({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "nope" } })) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32602);
  });

  test("a very long answer is cut", async () => {
    const huge = (await call({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "echo", arguments: { word: "huge" } } })) as { result: { content: { text: string }[] } };
    expect(huge.result.content[0].text.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(huge.result.content[0].text).toMatch(/cut here/);
  });

  test("malformed envelopes are refused, never taken for notifications; recognised notifications are processed but never answered", async () => {
    expect(await call({ jsonrpc: "2.0", id: { nested: true }, method: "ping" })).toMatchObject({ id: null, error: { code: -32600 } });
    expect(await call({ jsonrpc: "2.0", id: 1 })).toMatchObject({ id: 1, error: { code: -32600 } });
    expect(await call({ jsonrpc: "1.0", id: 2, method: "ping" })).toMatchObject({ id: 2, error: { code: -32600 } });
    expect(await call({})).toMatchObject({ id: null, error: { code: -32600 } });
    expect(await call({ jsonrpc: "2.0", method: "ping" })).toBeNull(); // a ping without an id is a notification: no answer
    const before = runs.echo;
    expect(await call({ jsonrpc: "2.0", method: "tools/call", params: { name: "echo", arguments: { word: "quiet" } } })).toBeNull();
    expect(runs.echo).toBe(before + 1); // …but it was still carried out
    const batch = (await call([{ jsonrpc: "2.0", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 20, method: "ping" }, { id: 21 }])) as { id: number | null; error?: unknown }[];
    expect(batch.map((answer) => answer.id)).toEqual([20, 21]);
    expect(batch[1].error).toBeTruthy();
    expect(await call([{ jsonrpc: "2.0", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }])).toBeNull();
  });

  test("arguments are checked against the tool's own schema before it runs: a misspelt or out-of-range option never falls back to a default", async () => {
    const before = runs.echo;
    const ask = async (args: unknown) => ((await call({ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "echo", arguments: args } })) as { result: { content: { text: string }[]; isError?: boolean } }).result;
    for (const [args, message] of [
      [{ day: 90 }, /Unknown option “day”/],
      [{ times: 6 }, /at most 5/],
      [{ times: 0 }, /at least 1/],
      [{ times: 2.5 }, /whole number/],
      [{ word: 5 }, /must be text/],
      [{ mode: "quiet" }, /must be one of “plain”, “loud”/],
    ] as const) {
      const result = await ask(args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(message);
    }
    expect((await ask("text")).isError).toBe(true);
    expect((await ask(["x"])).isError).toBe(true);
    expect(runs.echo).toBe(before); // none of them ran
    const good = await ask({ word: "hi", times: 5, mode: "loud" });
    expect(good.isError).toBeUndefined();
    expect((await ask({ word: null, times: null })).isError).toBeUndefined(); // null counts as “not given”
    expect((await ask(undefined)).isError).toBeUndefined();
    expect(runs.echo).toBe(before + 3);
  });

  test("bad messages and batches", async () => {
    expect(await call({ jsonrpc: "2.0", id: 12, method: "no/such" })).toMatchObject({ error: { code: -32601 } });
    expect(await call({ id: 13, method: "ping" })).toMatchObject({ error: { code: -32600 } });
    expect(await call("text")).toMatchObject({ error: { code: -32600 } }); // valid JSON that is not a request (bad JSON is a parse error, answered by the route)
    expect(await call(5)).toMatchObject({ error: { code: -32600 } });
    expect(await call([])).toMatchObject({ error: { code: -32600 } });
    const batch = (await call([{ jsonrpc: "2.0", id: 14, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 15, method: "ping" }])) as { id: number }[];
    expect(batch.map((answer) => answer.id)).toEqual([14, 15]);
  });
});
