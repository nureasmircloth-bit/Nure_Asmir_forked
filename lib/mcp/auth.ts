// Checking the access token of a request to the AI connection (the token itself is never stored, only its hash).

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { runInBackground } from "@/lib/background";
import { bearerToken, hashToken, parseScopes, tokenState, type Scope } from "./token";

export type McpAccess = { tokenId: string; label: string; scopes: Scope[]; createdBy: string };

export type McpAuthResult = { ok: true; access: McpAccess } | { ok: false; reason: "missing" | "invalid" | "expired" | "revoked" };

/** Finds the token behind "Authorization: Bearer …" and says whether it may be used right now. It only READS: a use is noted by recordTokenUse, after the request limit has let it through. */
export async function authenticateMcp(request: Request): Promise<McpAuthResult> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return { ok: false, reason: "missing" };
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, await hashToken(token))).limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  const state = tokenState(row);
  if (state !== "active") return { ok: false, reason: state };
  return { ok: true, access: { tokenId: row.id, label: row.label, scopes: parseScopes(row.scopes), createdBy: row.createdBy } };
}

/** Notes a good use (last used, how often) without slowing the answer. */
export function recordTokenUse(tokenId: string): void {
  runInBackground(
    Promise.resolve(db.update(mcpTokens).set({ lastUsedAt: new Date(), useCount: sql`${mcpTokens.useCount} + 1` }).where(eq(mcpTokens.id, tokenId))),
    "mcp token usage",
  );
}
