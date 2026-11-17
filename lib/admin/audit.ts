import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditLog } from "@/db/schema";
import { hashEntry } from "@/lib/admin/audit-chain";
import { refreshStorefront, STOREFRONT_ACTIONS } from "@/lib/storefront-cache";

/** The address a request came from (Cloudflare's header first), or null. */
export function requestIp(request: Request): string | null {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct) return direct.slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 64) : null;
}

/**
 * Writes one entry to the admin's change history.
 *
 * Besides who did what, an entry about a thing (`entityType` + `entityId`) gets a version number (1, 2, 3… for that thing), may carry the thing as it was `before` and `after` the change,
 * where it came from (`source`: "admin", or "ai: <token name>") and the address (`ip`), and is chained to the previous entry of the same thing with a hash (lib/admin/audit-chain.ts),
 * so the history of a product can be read, checked and, if needed, undone by hand.
 *
 * Note on atomicity: the Cloudflare D1 database used by this project (see db/index.ts) does not support interactive `db.transaction(...)`, so the chain is written
 * with plain sequential awaits. Two changes to the SAME thing in the same instant could share a previous entry; the check then names the entry, it never hides it.
 */
export async function auditLogEntry(params: {
  actorEmail: string;
  action: string;
  entityType?: string;
  entityId?: string;
  detail?: unknown;
  before?: unknown;
  after?: unknown;
  source?: string;
  ip?: string | null;
}) {
  // Every owner change that alters what the shop shows also refreshes the shop's page cache.
  if (STOREFRONT_ACTIONS.test(params.action)) refreshStorefront();
  const createdAt = new Date();
  const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
  const entityType = params.entityType ?? null;
  const entityId = params.entityId ?? null;
  let prevHash: string | null = null;
  let entityVersion: number | null = null;
  if (entityType && entityId) {
    const where = and(eq(adminAuditLog.entityType, entityType), eq(adminAuditLog.entityId, entityId));
    const [last] = await db.select({ hash: adminAuditLog.hash }).from(adminAuditLog).where(where).orderBy(desc(adminAuditLog.createdAt)).limit(1);
    const [{ total }] = await db.select({ total: count() }).from(adminAuditLog).where(where);
    prevHash = last?.hash ?? null;
    entityVersion = total + 1;
  }
  const fields = {
    prevHash,
    actorEmail: params.actorEmail,
    action: params.action,
    entityType,
    entityId,
    entityVersion,
    source: params.source ?? null,
    ip: params.ip ?? null,
    detail: json(params.detail),
    beforeJson: json(params.before),
    afterJson: json(params.after),
    createdAtMs: createdAt.getTime(),
  };
  const hash = await hashEntry(fields);
  return db.insert(adminAuditLog).values({
    actorEmail: fields.actorEmail,
    action: fields.action,
    entityType: fields.entityType ?? undefined,
    entityId: fields.entityId ?? undefined,
    detail: fields.detail,
    source: fields.source,
    ip: fields.ip,
    entityVersion,
    beforeJson: fields.beforeJson,
    afterJson: fields.afterJson,
    prevHash,
    hash,
    createdAt,
  });
}
