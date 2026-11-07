import { handleRpc } from "@/lib/mcp/protocol";
import { authenticateMcp, recordTokenUse } from "@/lib/mcp/auth";
import { allowBurst, MAX_PER_ADDRESS } from "@/lib/mcp/rate-limit";
import { allowSharedCall } from "@/lib/mcp/rate-limit-shared";
import { TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

/**
 * The AI connection (Model Context Protocol, plain HTTP): an assistant such as Claude or Gemini sends JSON-RPC messages here with the access token the owner
 * made under "AI assistants" in the admin. It is deliberately NOT behind the admin sign-in: an assistant has no browser session, so the token is its key. The token
 * is long and random, only its hash is stored, it expires, can be switched off, and it can only ever read (see lib/mcp/tools.ts). The address is  https://<admin site>/api/admin/mcp .
 *
 * Order of work, so bad traffic costs as little as possible: a request limit per address (memory only) → the token is looked up → the exact per-token limit (one database
 * upsert) → only then the use is noted and the message answered.
 */
const NO_STORE = { "Cache-Control": "no-store" };
/** The longest request body accepted, in bytes: a request is a short instruction, never a file. */
const MAX_BODY_BYTES = 100_000;

/** A JSON-RPC error answer with the matching HTTP status. */
const error = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });

/** Reads the body but stops as soon as it is longer than the limit (the rest is never held in memory). Gives null when it is too long. */
async function readBounded(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Answers one MCP message (or a batch). */
export async function POST(request: Request) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  if (!allowBurst(`address:${address}`, MAX_PER_ADDRESS)) return error(429, -32002, "Too many requests. Wait a minute and try again.", { "Retry-After": "30" });

  const auth = await authenticateMcp(request);
  if (!auth.ok) {
    const messages = {
      missing: "Send the access token as “Authorization: Bearer na_mcp_…”.",
      invalid: "This access token is not known. Make a new one under AI assistants in the admin.",
      expired: "This access token has expired. Make a new one under AI assistants in the admin.",
      revoked: "This access token was switched off. Make a new one under AI assistants in the admin.",
    } as const;
    return error(401, -32001, messages[auth.reason], { "WWW-Authenticate": 'Bearer realm="nure-asmir-admin"' });
  }
  if (!(await allowSharedCall(auth.access.tokenId))) return error(429, -32002, "Too many requests. Wait a minute and try again.", { "Retry-After": "30" });
  recordTokenUse(auth.access.tokenId);

  const raw = await readBounded(request);
  if (raw === null) return error(413, -32600, "Request too large.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, -32700, "Parse error.");
  }
  const answer = await handleRpc(body, TOOLS, { scopes: auth.access.scopes, tokenId: auth.access.tokenId, label: auth.access.label });
  if (answer === null) return new Response(null, { status: 202, headers: NO_STORE });
  return Response.json(answer, { headers: NO_STORE });
}

/** This server does not stream (no server-sent events), which the protocol allows: a GET is answered “not offered”. */
export async function GET() {
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
