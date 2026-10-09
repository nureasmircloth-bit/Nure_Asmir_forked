import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminMessages, adminPushDevices, customerPushDevices } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { pushConfigured, sendPush } from "@/lib/push/fcm";

export const dynamic = "force-dynamic";

// A Worker may only make a limited number of outside calls per request, so a big audience is sent in slices: the page asks again
// with the last device it reached (a "cursor") until everyone has been reached, and shows the progress. Paging by "everything after
// this device" (instead of "skip N") means phones that register, leave or change their choice during the send are never skipped
// or sent to twice.
const SLICE = 40;

const schema = z.object({
  title: z.string().trim().min(1, "Write a short title.").max(60, "Keep the title under 60 letters."),
  body: z.string().trim().min(1, "Write the message.").max(180, "Keep the message under 180 letters."),
  /** A page on your website to open when the notification is tapped, like /shop or /collections/shirts. */
  url: z.string().trim().max(200).optional(),
  audience: z.enum(["all", "sales", "test"]),
  /** The last device token of the previous slice (empty for the first slice). */
  cursor: z.string().max(4096).optional(),
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
  const { title, body, audience, cursor } = parsed.data;
  const url = audience === "test" ? "/admin" : cleanPath(parsed.data.url);

  const isTest = audience === "test";
  const table = isTest ? adminPushDevices : customerPushDevices;
  const audienceFilter = audience === "sales" ? eq(customerPushDevices.salesOptIn, true) : undefined;

  // The history row exists BEFORE anything is sent, so a failed write afterwards can never leave sent notifications unrecorded.
  let messageId = parsed.data.messageId;
  let total = 0;
  if (!messageId) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(table).where(audienceFilter);
    total = count;
    const [row] = await db.insert(adminMessages).values({ kind: "push", audience, title, body, link: url, recipients: total, delivered: 0, createdBy: admin.email }).returning({ id: adminMessages.id });
    messageId = row.id;
    await auditLogEntry({ actorEmail: admin.email, action: "message.push", entityType: "message", entityId: messageId, detail: { audience, title, recipients: total } });
  } else {
    const [row] = await db.select({ recipients: adminMessages.recipients }).from(adminMessages).where(eq(adminMessages.id, messageId)).limit(1);
    if (!row) return Response.json({ error: "That message could not be found." }, { status: 404 });
    total = row.recipients;
  }

  const rows = await db
    .select({ token: table.token })
    .from(table)
    .where(and(audienceFilter, cursor ? gt(table.token, cursor) : undefined))
    .orderBy(asc(table.token))
    .limit(SLICE);

  const results = await Promise.all(rows.map(async (row) => ({ token: row.token, result: await sendPush(row.token, { title, body, url, tag: `msg-${messageId}` }) })));
  const delivered = results.filter((entry) => entry.result === "ok").length;
  const dead = results.filter((entry) => entry.result === "dead").map((entry) => entry.token);
  if (dead.length) await db.delete(table).where(inArray(table.token, dead)).catch((error) => console.error("could not remove dead devices", error));
  // The notifications of this slice are already out: a failed record must not stop the answer, or the page would lose its place and send again.
  if (delivered) await db.update(adminMessages).set({ delivered: sql`${adminMessages.delivered} + ${delivered}` }).where(eq(adminMessages.id, messageId)).catch((error) => console.error("could not record the delivery", error));

  return Response.json({ messageId, total, delivered, cursor: rows.length ? rows[rows.length - 1].token : cursor ?? "", done: rows.length < SLICE });
}
