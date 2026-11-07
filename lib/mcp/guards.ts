// Two guards for the tools that add products, both kept in the database so they hold no matter which copy of the Worker answers:
//  - a confirmation: prepare_products hands out a random, single-use code tied to one token and to exactly the rows it previewed; create_products refuses anything else, so the
//    preview cannot be skipped, replayed or used for other rows. (It proves a preview was made for these rows. It does not prove a person looked at it: that is up to the assistant
//    asking the owner, and in the end to the owner pressing Publish, because everything is saved hidden.)
//  - a daily quota: capacity is taken in ONE atomic statement before anything is created, so calls at the same moment cannot go over the limit.

import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { mcpConfirmations } from "@/db/schema";

/** Most products assistants may add in one day (UTC), all tokens together. */
export const DAILY_LIMIT = 2000;
/** How long a preview's confirmation may be used. */
export const CONFIRMATION_MINUTES = 30;

/** A new confirmation for these previewed rows (the digest), good for CONFIRMATION_MINUTES and for one use. Old ones are swept away now and then. */
export async function issueConfirmation(tokenId: string, digest: string): Promise<string> {
  const code = `prep_${[...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  await db.insert(mcpConfirmations).values({ code, tokenId, digest, expiresAt: new Date(Date.now() + CONFIRMATION_MINUTES * 60_000) });
  await db.delete(mcpConfirmations).where(lt(mcpConfirmations.expiresAt, new Date(Date.now() - 86_400_000))).catch(() => undefined);
  return code;
}

/** Uses a confirmation up, in one atomic update: true only for a code that belongs to this token, was made for exactly these rows, has not expired and was never used. */
export async function redeemConfirmation(tokenId: string, code: string, digest: string): Promise<boolean> {
  const used = await db
    .update(mcpConfirmations)
    .set({ usedAt: new Date() })
    .where(and(eq(mcpConfirmations.code, code), eq(mcpConfirmations.tokenId, tokenId), eq(mcpConfirmations.digest, digest), isNull(mcpConfirmations.usedAt), gt(mcpConfirmations.expiresAt, new Date())))
    .returning({ code: mcpConfirmations.code });
  return used.length === 1;
}

/** Takes room for `count` products from today's quota, atomically. Gives the day it was taken from (to give back what is not used), or null when there is not enough room. */
export async function reserveQuota(count: number): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  const rows = await db.all<{ added: number }>(
    sql`insert into mcp_daily_quota (day, added) values (${day}, ${count}) on conflict (day) do update set added = added + excluded.added where added + excluded.added <= ${DAILY_LIMIT} returning added`,
  );
  return rows.length ? day : null;
}

/** Gives back the room that was reserved but not used (products that failed, or were not made). */
export async function releaseQuota(day: string, unused: number): Promise<void> {
  if (unused <= 0) return;
  await db.run(sql`update mcp_daily_quota set added = max(0, added - ${unused}) where day = ${day}`);
}
