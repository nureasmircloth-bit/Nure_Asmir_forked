import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/** Switches a token off at once. It stays in the list (marked “switched off”) so the owner can see who had access and when. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const [row] = await db.update(mcpTokens).set({ revokedAt: new Date() }).where(and(eq(mcpTokens.id, id), isNull(mcpTokens.revokedAt))).returning({ id: mcpTokens.id, label: mcpTokens.label });
  if (!row) return Response.json({ error: "This token was not found or is already switched off." }, { status: 404 });
  await auditLogEntry({ actorEmail: admin.email, action: "mcp.token.revoke", entityType: "mcp_token", entityId: row.id, detail: { label: row.label } });
  return Response.json({ ok: true });
}
