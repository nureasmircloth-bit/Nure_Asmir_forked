import { desc, isNull, and, gt, count } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";
import { DEFAULT_LIFETIME, generateToken, hashToken, isScope, LIFETIMES, parseScopes, tokenHint, tokenState } from "@/lib/mcp/token";

export const dynamic = "force-dynamic";

/** At most this many tokens can be in use (not expired, not switched off) at once. */
const MAX_ACTIVE = 10;

const refusal = () => (process.env.SANDBOX === "1" ? "AI access is not part of the practice shop." : null);

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

  const [{ active }] = await db.select({ active: count() }).from(mcpTokens).where(and(isNull(mcpTokens.revokedAt), gt(mcpTokens.expiresAt, new Date())));
  if (active >= MAX_ACTIVE) return Response.json({ error: `${MAX_ACTIVE} tokens are already in use. Switch one off first.` }, { status: 400 });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + lifetime.ms);
  const scopes = [...new Set(wanted)].join(",");
  const [row] = await db
    .insert(mcpTokens)
    .values({ label, tokenHash: await hashToken(token), tokenPrefix: tokenHint(token), scopes, createdBy: admin.email, expiresAt })
    .returning({ id: mcpTokens.id });
  await auditLogEntry({ actorEmail: admin.email, action: "mcp.token.create", entityType: "mcp_token", entityId: row.id, detail: { label, scopes, lifetime: lifetime.key } });
  return Response.json({ token, id: row.id, expiresAt: expiresAt.getTime(), label, scopes: parseScopes(scopes) }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
