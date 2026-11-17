// Tamper evidence for the admin's change history. Every entry about the same thing (a product, a category…) carries the hash of the entry before it and a hash of its own content,
// so an entry that is edited, removed from the middle or inserted afterwards no longer fits and is reported. Pure functions (Web Crypto only), used by the history screens and tested alone.

export type ChainFields = {
  prevHash: string | null;
  actorEmail: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityVersion: number | null;
  source: string | null;
  ip: string | null;
  detail: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  createdAtMs: number;
};

/** The hash of one entry: SHA-256 over every field in a fixed order, written as hex. */
export async function hashEntry(fields: ChainFields): Promise<string> {
  const ordered = [fields.prevHash, fields.actorEmail, fields.action, fields.entityType, fields.entityId, fields.entityVersion, fields.source, fields.ip, fields.detail, fields.beforeJson, fields.afterJson, fields.createdAtMs];
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(ordered)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ChainRow = ChainFields & { hash: string | null };
export type ChainCheck = { ok: boolean; checked: number; legacy: number; /** the entry (oldest first, from 0) that does not fit */ brokenAt?: number; reason?: string };

/** Checks the entries of one thing, oldest first. Entries from before the history was recorded (no hash) are counted as `legacy` and skipped. */
export async function verifyChain(rowsOldestFirst: ChainRow[]): Promise<ChainCheck> {
  let checked = 0;
  let legacy = 0;
  let previous: string | null = null;
  for (let index = 0; index < rowsOldestFirst.length; index++) {
    const row = rowsOldestFirst[index];
    if (!row.hash) {
      legacy++;
      continue;
    }
    if (checked > 0 && row.prevHash !== previous) return { ok: false, checked, legacy, brokenAt: index, reason: "An entry before this one was changed or removed." };
    if ((await hashEntry(row)) !== row.hash) return { ok: false, checked, legacy, brokenAt: index, reason: "This entry was changed after it was written." };
    previous = row.hash;
    checked++;
  }
  return { ok: true, checked, legacy };
}
