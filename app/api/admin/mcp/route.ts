import { handleRpc } from "@/lib/mcp/protocol";
import { authenticateMcp } from "@/lib/mcp/auth";
import { allowCall } from "@/lib/mcp/rate-limit";
import { TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

/**
 * The AI connection (Model Context Protocol, plain HTTP): an assistant such as Claude or Gemini sends JSON-RPC messages here with the access token the owner
 * made under "AI assistants" in the admin. It is NOT behind the admin sign-in (the assistant has no browser session); the token is its key, and it only
 * ever reads (see lib/mcp/tools.ts). The address is  https://<admin site>/api/admin/mcp .
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const auth = await authenticateMcp(request);
  if (!auth.ok) {
    const messages = {
      missing: "Send the access token as “Authorization: Bearer na_mcp_…”.",
      invalid: "This access token is not known. Make a new one under AI assistants in the admin.",
      expired: "This access token has expired. Make a new one under AI assistants in the admin.",
      revoked: "This access token was switched off. Make a new one under AI assistants in the admin.",
    } as const;
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: messages[auth.reason] } }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": 'Bearer realm="nure-asmir-admin"' } });
  }
  if (!allowCall(auth.access.tokenId)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Too many requests. Wait a minute and try again." } }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });
  }
  // Keep the body small: a request is a short instruction, never a file.
  const raw = await request.text();
  if (raw.length > 100_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, { status: 413, headers: NO_STORE });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, { status: 400, headers: NO_STORE });
  }
  const answer = await handleRpc(body, TOOLS, { scopes: auth.access.scopes, tokenId: auth.access.tokenId, label: auth.access.label });
  if (answer === null) return new Response(null, { status: 202, headers: NO_STORE });
  return Response.json(answer, { headers: NO_STORE });
}

/** This server does not stream (no server-sent events), which the protocol allows: a GET is answered “not offered”. */
export async function GET() {
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
