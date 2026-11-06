// Checking the access token of a request to the AI connection (the token itself is never stored, only its hash).

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { runInBackground } from "@/lib/background";
import { bearerToken, hashToken, parseScopes, tokenState, type Scope } from "./token";

export type McpAccess = { tokenId: string; label: string; scopes: Scope[]; createdBy: string };

export type McpAuthResult = { ok: true; access: McpAccess } | { ok: false; reason: "missing" | "invalid" | "expired" | "revoked" };

/** Finds the token behind "Authorization: Bearer …" and says whether it may be used right now. A good use is noted (last used, how often) without slowing the answer. */
export async function authenticateMcp(request: Request): Promise<McpAuthResult> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return { ok: false, reason: "missing" };
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, await hashToken(token))).limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  const state = tokenState(row);
  if (state !== "active") return { ok: false, reason: state };
  runInBackground(
    Promise.resolve(db.update(mcpTokens).set({ lastUsedAt: new Date(), useCount: sql`${mcpTokens.useCount} + 1` }).where(eq(mcpTokens.id, row.id))),
    "mcp token usage",
  );
  return { ok: true, access: { tokenId: row.id, label: row.label, scopes: parseScopes(row.scopes), createdBy: row.createdBy } };
}
