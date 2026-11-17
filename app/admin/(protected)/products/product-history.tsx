import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditLog, productVariants } from "@/db/schema";
import { verifyChain, type ChainRow } from "@/lib/admin/audit-chain";
import { changedFields } from "@/lib/admin/snapshots";
import { Badge } from "../../_ui/ui";

const FIELD_NAMES: Record<string, string> = {
  name: "Name", slug: "Web address", categoryId: "Category", subcategory: "Subcategory", status: "Status", typeLabel: "Type", shortDescription: "Short description", description: "Description", material: "Fabric", badge: "Label",
  featured: "Featured", priceOnRequest: "Price on request", comingSoon: "Coming soon", seoTitle: "Search title", seoDescription: "Search description", seoKeywords: "Search keywords", seoLocked: "Search text locked",
  primaryColour: "Colour", gender: "For", sku: "Product code", color: "Colour", size: "Size", price: "Price", compareAtPrice: "Old price", stockQuantity: "Stock", isDefault: "Main size",
};
const ACTION_NAMES: Record<string, string> = {
  "product.update": "Product changed", "product.archive": "Product hidden and kept", "product.delete_permanent": "Product deleted", "variant.update": "Size changed", "variant.archive": "Size hidden",
  "product.create": "Product added", "mcp.products.create": "Added by an AI assistant",
};

const show = (value: unknown) => (value === null || value === undefined || value === "" ? "(empty)" : String(value).length > 80 ? `${String(value).slice(0, 80)}…` : String(value));
const parse = (text: string | null) => {
  if (!text) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
};

/** The history of one product and its sizes: who changed what and when, with the version number, where the change came from, what it was before and after, and a check that no entry was altered. */
export async function ProductHistory({ productId }: { productId: string }) {
  const variants = await db.select({ id: productVariants.id, sku: productVariants.sku, size: productVariants.size, color: productVariants.color }).from(productVariants).where(eq(productVariants.productId, productId));
  const variantIds = variants.map((variant) => variant.id);
  const where = variantIds.length
    ? or(and(eq(adminAuditLog.entityType, "product"), eq(adminAuditLog.entityId, productId)), and(eq(adminAuditLog.entityType, "variant"), inArray(adminAuditLog.entityId, variantIds.slice(0, 90))))
    : and(eq(adminAuditLog.entityType, "product"), eq(adminAuditLog.entityId, productId));
  const rows = await db.select().from(adminAuditLog).where(where).orderBy(desc(adminAuditLog.createdAt)).limit(200);

  // Each thing (the product, each size) has its own chain: check them one by one.
  const chains = new Map<string, ChainRow[]>();
  for (const row of [...rows].reverse()) {
    const key = `${row.entityType}:${row.entityId}`;
    chains.set(key, [...(chains.get(key) ?? []), { prevHash: row.prevHash, actorEmail: row.actorEmail, action: row.action, entityType: row.entityType, entityId: row.entityId, entityVersion: row.entityVersion, source: row.source, ip: row.ip, detail: row.detail, beforeJson: row.beforeJson, afterJson: row.afterJson, createdAtMs: row.createdAt.getTime(), hash: row.hash }]);
  }
  const checks = await Promise.all([...chains.values()].map((chain) => verifyChain(chain)));
  const broken = checks.find((check) => !check.ok);
  const checked = checks.reduce((sum, check) => sum + check.checked, 0);
  const sizeName = (id: string | null) => {
    const variant = variants.find((item) => item.id === id);
    return variant ? `${variant.color}${variant.size ? ` · ${variant.size}` : ""} (${variant.sku})` : "a size";
  };

  return (
    <section className="a-card" style={{ marginTop: 18 }} id="history">
      <header className="a-card-head">
        <h2>History of this product</h2>
        <small>{rows.length ? `${rows.length} change${rows.length === 1 ? "" : "s"}` : "No changes recorded yet"}</small>
      </header>
      <div className="a-card-pad a-stack" style={{ gap: 12 }}>
        <p className="a-muted" style={{ margin: 0 }}>Every change is kept here with who made it, when, and what it was before. Entries cannot be edited: if one is ever changed afterwards, the check below says so.</p>
        {rows.length > 0 && (
          broken ? <Badge tone="bad">Check failed: {broken.reason}</Badge> : <Badge tone="done">{checked > 0 ? `Check passed: ${checked} entr${checked === 1 ? "y is" : "ies are"} unchanged since they were written` : "Older entries (written before this check existed)"}</Badge>
        )}
        {rows.map((row) => {
          const before = parse(row.beforeJson);
          const after = parse(row.afterJson);
          const changes = changedFields(before, after);
          const detail = parse(row.detail);
          const lines = Array.isArray(detail) ? (detail as unknown as string[]) : [];
          const when = row.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
          return (
            <article key={row.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <div className="a-row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <strong>{ACTION_NAMES[row.action] ?? row.action}{row.entityType === "variant" ? ` — ${sizeName(row.entityId)}` : ""}</strong>
                <span className="a-muted">{when}{row.entityVersion ? ` · version ${row.entityVersion}` : ""}</span>
              </div>
              <div className="a-muted" style={{ fontSize: 13.5 }}>
                By {row.actorEmail}
                {row.source && row.source !== "admin" ? ` (${row.source})` : ""}
                {row.ip ? ` · from ${row.ip}` : ""}
              </div>
              {changes.length > 0 ? (
                <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: 14 }}>
                  {changes.map((change) => (
                    <li key={change.field}><strong>{FIELD_NAMES[change.field] ?? change.field}:</strong> {show(change.before)} → {show(change.after)}</li>
                  ))}
                </ul>
              ) : lines.length > 0 ? (
                <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: 14 }}>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
