import { desc, eq, sql } from "drizzle-orm";
import { db, runAtomically } from "@/db";
import { mcpTokens } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { DEFAULT_LIFETIME, generateToken, hashToken, isScope, LIFETIMES, parseScopes, tokenHint, tokenState } from "@/lib/mcp/token";

export const dynamic = "force-dynamic";

/** At most this many tokens can be in use (not expired, not switched off) at once. */
const MAX_ACTIVE = 10;

/** The practice shop has no AI access: its tokens would point at a throw-away copy of the shop. */
const refusal = () => (process.env.SANDBOX === "1" ? "AI access is not part of the practice shop." : null);

/** The tokens made so far (never the tokens themselves, only their names, hints and state). */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.select().from(mcpTokens).orderBy(desc(mcpTokens.createdAt)).limit(50);
  return Response.json({
    tokens: rows.map((row) => ({
      id: row.id,
      label: row.label,
      prefix: row.tokenPrefix,
      scopes: parseScopes(row.scopes),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      useCount: row.useCount,
      state: tokenState(row),
    })),
  });
}

/** Makes a token. The token is in this answer once and nowhere else: only its hash is kept. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = refusal();
  if (blocked) return Response.json({ error: blocked }, { status: 400 });
  if (admin.role !== "owner") return Response.json({ error: "Only the owner can give an AI assistant access." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { label?: unknown; scopes?: unknown; lifetime?: unknown };
  const label = typeof body.label === "string" ? body.label.trim().replace(/\s+/g, " ") : "";
  if (label.length < 2 || label.length > 60) return Response.json({ error: "Give the token a name of 2 to 60 letters, for example “Claude on my laptop”." }, { status: 400 });
  const wanted = Array.isArray(body.scopes) ? body.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  if (!wanted.length || !wanted.every(isScope)) return Response.json({ error: "Choose what the assistant may look at." }, { status: 400 });
  const lifetime = LIFETIMES.find((option) => option.key === (typeof body.lifetime === "string" ? body.lifetime : DEFAULT_LIFETIME));
  if (!lifetime) return Response.json({ error: "Choose how long the token should work." }, { status: 400 });

  const token = generateToken();
  const now = Date.now();
  const expiresAt = now + lifetime.ms;
  const scopes = [...new Set(wanted)].join(",");
  const id = crypto.randomUUID();
  const detail = JSON.stringify({ label, scopes, lifetime: lifetime.key });
  // One all-or-nothing batch: the token is inserted only while fewer than MAX_ACTIVE are in use (the count and the insert are ONE statement, so two requests at once cannot both
  // slip under the limit), and the activity-log entry is written only if the token was, so neither can exist without the other.
  await runAtomically([
    sql`insert into mcp_tokens (id, label, token_hash, token_prefix, scopes, created_by, expires_at)
        select ${id}, ${label}, ${await hashToken(token)}, ${tokenHint(token)}, ${scopes}, ${admin.email}, ${expiresAt}
        where (select count(*) from mcp_tokens where revoked_at is null and expires_at > ${now}) < ${MAX_ACTIVE}`,
    sql`insert into admin_audit_log (actor_email, action, entity_type, entity_id, detail)
        select ${admin.email}, 'mcp.token.create', 'mcp_token', ${id}, ${detail}
        where exists (select 1 from mcp_tokens where id = ${id})`,
  ]);
  const [made] = await db.select({ id: mcpTokens.id }).from(mcpTokens).where(eq(mcpTokens.id, id)).limit(1);
  if (!made) return Response.json({ error: `${MAX_ACTIVE} tokens are already in use. Switch one off first.` }, { status: 400 });
  return Response.json({ token, id, expiresAt, label, scopes: parseScopes(scopes) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
