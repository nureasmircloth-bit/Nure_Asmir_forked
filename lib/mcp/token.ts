// Access tokens for AI assistants. Pure helpers (Web Crypto only), so they run in the Worker, in the browser tests and in Node alike.
//
// A token looks like  na_mcp_<43 random characters>  (32 random bytes, base64url). Only its SHA-256 hash is stored; the token itself is shown once.

export const TOKEN_PREFIX = "na_mcp_";

/** What a token may do. Every scope is read-only for now; the ones that change the shop come with their own scope later. */
export const SCOPES = {
  "catalog:read": "Look at products, sizes, prices, stock and categories",
  "sales:read": "See sales totals and order counts (no customer names, phones or addresses)",
} as const;
export type Scope = keyof typeof SCOPES;
export const DEFAULT_SCOPES: Scope[] = ["catalog:read"];

/** How long a token lives. Short on purpose: the owner makes a new one whenever an assistant needs access. */
export const LIFETIMES = [
  { key: "1h", label: "1 hour", ms: 3_600_000 },
  { key: "8h", label: "8 hours", ms: 8 * 3_600_000 },
  { key: "24h", label: "24 hours", ms: 24 * 3_600_000 },
  { key: "7d", label: "7 days", ms: 7 * 24 * 3_600_000 },
] as const;
export type LifetimeKey = (typeof LIFETIMES)[number]["key"];
export const DEFAULT_LIFETIME: LifetimeKey = "8h";

/** Whether a text is one of the scope names a token can have. */
export function isScope(value: string): value is Scope {
  return Object.prototype.hasOwnProperty.call(SCOPES, value);
}

/** "catalog:read, bogus ,sales:read" → ["catalog:read", "sales:read"]: unknown names are dropped, repeats are removed. */
export function parseScopes(text: string | null | undefined): Scope[] {
  return [...new Set(String(text ?? "").split(",").map((part) => part.trim()).filter(isScope))];
}

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A new token: the prefix and 32 random bytes. */
export function generateToken(): string {
  return TOKEN_PREFIX + toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of the token as lowercase hex. The token is random and long, so a plain fast hash is the right tool (no password stretching needed). */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The token in a request: "Authorization: Bearer na_mcp_…". Anything else gives null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match && match[1].startsWith(TOKEN_PREFIX) && match[1].length < 200 ? match[1] : null;
}

/** What the list shows instead of the token: "na_mcp_AbCd…". */
export const tokenHint = (token: string) => `${token.slice(0, TOKEN_PREFIX.length + 4)}…`;

export type TokenState = "active" | "expired" | "revoked";
/** Whether a token can be used now, has run out of time or was switched off by the owner. */
export function tokenState(row: { expiresAt: Date | number; revokedAt: Date | number | null }, now = Date.now()): TokenState {
  if (row.revokedAt) return "revoked";
  return new Date(row.expiresAt).getTime() <= now ? "expired" : "active";
}
