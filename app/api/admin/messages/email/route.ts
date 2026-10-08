import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminMessages, subscribers } from "@/db/schema";
import { auditLogEntry } from "@/lib/admin/audit";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { siteOrigin } from "@/lib/brand";
import { sendCustomEmail } from "@/lib/email/resend";
import { emailAllowance } from "@/lib/email/transport";
import { customEmailHtml } from "@/lib/messages";
import { unsubscribeUrl } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

// A Worker may only make a limited number of outside calls per request: a list is sent in slices, each continuing "after the last address
// of the previous slice" (a cursor, not "skip N"), so people who unsubscribe or join during the send are never skipped or written to twice.
const SLICE = 15;

const schema = z.object({
  mode: z.enum(["one", "list"]),
  to: z.string().trim().email("That email address does not look right.").max(200).optional(),
  subject: z.string().trim().min(1, "Write a subject.").max(120, "Keep the subject under 120 letters."),
  body: z.string().trim().min(1, "Write the message.").max(5000, "That message is too long."),
  buttonLabel: z.string().trim().max(40).optional(),
  buttonUrl: z.string().trim().max(300).optional(),
  /** The last address of the previous slice (empty for the first slice). */
  cursor: z.string().max(320).optional(),
  messageId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Please check the message." }, { status: 400 });
  const input = parsed.data;
  if (input.buttonUrl && !/^https?:\/\//i.test(input.buttonUrl)) return Response.json({ error: "A button link must start with https://" }, { status: 400 });

  const allowance = await emailAllowance();
  if (!allowance.providers) return Response.json({ error: "Email is not connected yet." }, { status: 400 });

  // ----- one customer
  if (input.mode === "one") {
    if (!input.to) return Response.json({ error: "Type the customer's email address." }, { status: 400 });
    if (allowance.left < 1) return Response.json({ error: "Today's free emails are used up. Try again tomorrow, or use WhatsApp." }, { status: 429 });
    const [row] = await db
      .insert(adminMessages)
      .values({ kind: "email", audience: "one", title: input.subject, body: input.body.slice(0, 500), link: input.buttonUrl ?? null, recipients: 1, delivered: 0, createdBy: admin.email })
      .returning({ id: adminMessages.id });
    const ok = await sendCustomEmail(input.to, input.subject, customEmailHtml({ subject: input.subject, body: input.body, buttonLabel: input.buttonLabel, buttonUrl: input.buttonUrl }));
    if (!ok) return Response.json({ error: "The email could not be sent. Please try again in a minute." }, { status: 502 });
    await db.update(adminMessages).set({ delivered: 1 }).where(eq(adminMessages.id, row.id)).catch((error) => console.error("could not record the delivery", error));
    await auditLogEntry({ actorEmail: admin.email, action: "message.email", entityType: "message", entityId: row.id, detail: { mode: "one", subject: input.subject } });
    return Response.json({ messageId: row.id, total: 1, delivered: 1, cursor: input.to, done: true });
  }

  // ----- the whole email list, in slices
  const subscribed = eq(subscribers.status, "subscribed");
  let messageId = input.messageId;
  let total = 0;
  if (!messageId) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(subscribers).where(subscribed);
    total = count;
    if (!total) return Response.json({ error: "Nobody has joined your email list yet." }, { status: 400 });
    if (allowance.left < total) {
      return Response.json({ error: `Your list has ${total} people but only ${allowance.left} free emails are left today. Send it tomorrow, or write to fewer people.` }, { status: 429 });
    }
    // The history row exists BEFORE anything is sent, so a failed write afterwards can never leave sent emails unrecorded.
    const [row] = await db
      .insert(adminMessages)
      .values({ kind: "email", audience: "list", title: input.subject, body: input.body.slice(0, 500), link: input.buttonUrl ?? null, recipients: total, delivered: 0, createdBy: admin.email })
      .returning({ id: adminMessages.id });
    messageId = row.id;
    await auditLogEntry({ actorEmail: admin.email, action: "message.email", entityType: "message", entityId: messageId, detail: { mode: "list", subject: input.subject, recipients: total } });
  } else {
    const [row] = await db.select({ recipients: adminMessages.recipients }).from(adminMessages).where(eq(adminMessages.id, messageId)).limit(1);
    if (!row) return Response.json({ error: "That message could not be found." }, { status: 404 });
    total = row.recipients;
  }

  const rows = await db
    .select({ email: subscribers.email })
    .from(subscribers)
    .where(and(subscribed, input.cursor ? gt(subscribers.email, input.cursor) : undefined))
    .orderBy(asc(subscribers.email))
    .limit(SLICE);
  const origin = siteOrigin();
  const sent = await Promise.all(
    rows.map(async (row) =>
      sendCustomEmail(
        row.email,
        input.subject,
        customEmailHtml({ subject: input.subject, body: input.body, buttonLabel: input.buttonLabel, buttonUrl: input.buttonUrl, unsubscribeUrl: await unsubscribeUrl(origin, row.email) }),
      ),
    ),
  );
  const delivered = sent.filter(Boolean).length;
  // The emails of this slice are already out: a failed record must not stop the answer, or the page would lose its place and send again.
  if (delivered) await db.update(adminMessages).set({ delivered: sql`${adminMessages.delivered} + ${delivered}` }).where(eq(adminMessages.id, messageId)).catch((error) => console.error("could not record the delivery", error));
  return Response.json({ messageId, total, delivered, cursor: rows.length ? rows[rows.length - 1].email : input.cursor ?? "", done: rows.length < SLICE });
}
