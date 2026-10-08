import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminMessages, adminPushDevices, customerPushDevices } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { pushConfigured, sendPush } from "@/lib/push/fcm";

export const dynamic = "force-dynamic";

// A Worker may only make a limited number of outside calls per request, so a big audience is sent in slices: the page asks again
// with the next offset until everyone has been reached, and shows the progress.
const SLICE = 40;

const schema = z.object({
  title: z.string().trim().min(1, "Write a short title.").max(60, "Keep the title under 60 letters."),
  body: z.string().trim().min(1, "Write the message.").max(180, "Keep the message under 180 letters."),
  /** A page on your website to open when the notification is tapped, like /shop or /collections/shirts. */
  url: z.string().trim().max(200).optional(),
  audience: z.enum(["all", "sales", "test"]),
  offset: z.number().int().min(0).default(0),
  /** The id of the history row, once the first slice has created it. */
  messageId: z.string().uuid().optional(),
});

const cleanPath = (value: string | undefined): string => (value && /^\/(?!\/)[\w\-./?=&%]*$/.test(value) ? value : "/shop");

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushConfigured()) return Response.json({ error: "Notifications are not connected yet (the Firebase key is missing)." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Please check the message." }, { status: 400 });
  const { title, body, audience, offset } = parsed.data;
  const url = audience === "test" ? "/admin" : cleanPath(parsed.data.url);

  const isTest = audience === "test";
  const table = isTest ? adminPushDevices : customerPushDevices;
  const where = audience === "sales" ? eq(customerPushDevices.salesOptIn, true) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(table).where(where);
  const rows = await db.select({ token: table.token }).from(table).where(where).orderBy(asc(table.token)).limit(SLICE).offset(offset);

  const results = await Promise.all(rows.map(async (row) => ({ token: row.token, result: await sendPush(row.token, { title, body, url, tag: `msg-${Date.now()}` }) })));
  const delivered = results.filter((entry) => entry.result === "ok").length;
  const dead = results.filter((entry) => entry.result === "dead").map((entry) => entry.token);
  if (dead.length) await db.delete(table).where(inArray(table.token, dead));

  // devices that were removed shift the next slice back by the same amount
  const next = offset + rows.length - dead.length;
  const done = rows.length < SLICE || offset + rows.length >= total;
  let messageId = parsed.data.messageId;
  if (!messageId) {
    const [row] = await db.insert(adminMessages).values({ kind: "push", audience, title, body, link: url, recipients: total, delivered, createdBy: admin.email }).returning({ id: adminMessages.id });
    messageId = row.id;
    await auditLogEntry({ actorEmail: admin.email, action: "message.push", entityType: "message", entityId: messageId, detail: { audience, title, recipients: total } });
  } else {
    await db.update(adminMessages).set({ delivered: sql`${adminMessages.delivered} + ${delivered}` }).where(eq(adminMessages.id, messageId));
  }
  return Response.json({ messageId, total, delivered, next, done });
}
