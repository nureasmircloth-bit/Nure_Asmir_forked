import { asc, eq, sql } from "drizzle-orm";
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

// A Worker may only make a limited number of outside calls per request: a list is sent in slices (see the push route).
const SLICE = 15;

const schema = z.object({
  mode: z.enum(["one", "list"]),
  to: z.string().trim().email("That email address does not look right.").max(200).optional(),
  subject: z.string().trim().min(1, "Write a subject.").max(120, "Keep the subject under 120 letters."),
  body: z.string().trim().min(1, "Write the message.").max(5000, "That message is too long."),
  buttonLabel: z.string().trim().max(40).optional(),
  buttonUrl: z.string().trim().max(300).optional(),
  offset: z.number().int().min(0).default(0),
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
    const ok = await sendCustomEmail(input.to, input.subject, customEmailHtml({ subject: input.subject, body: input.body, buttonLabel: input.buttonLabel, buttonUrl: input.buttonUrl }));
    if (!ok) return Response.json({ error: "The email could not be sent. Please try again in a minute." }, { status: 502 });
    const [row] = await db
      .insert(adminMessages)
      .values({ kind: "email", audience: "one", title: input.subject, body: input.body.slice(0, 500), link: input.buttonUrl ?? null, recipients: 1, delivered: 1, createdBy: admin.email })
      .returning({ id: adminMessages.id });
    await auditLogEntry({ actorEmail: admin.email, action: "message.email", entityType: "message", entityId: row.id, detail: { mode: "one", subject: input.subject } });
    return Response.json({ messageId: row.id, total: 1, delivered: 1, next: 1, done: true });
  }

  // ----- the whole email list, in slices
  const where = eq(subscribers.status, "subscribed");
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(subscribers).where(where);
  if (!total) return Response.json({ error: "Nobody has joined your email list yet." }, { status: 400 });
  if (input.offset === 0 && allowance.left < total) {
    return Response.json({ error: `Your list has ${total} people but only ${allowance.left} free emails are left today. Send it tomorrow, or write to fewer people.` }, { status: 429 });
  }
  const rows = await db.select({ email: subscribers.email }).from(subscribers).where(where).orderBy(asc(subscribers.email)).limit(SLICE).offset(input.offset);
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
  const done = rows.length < SLICE || input.offset + rows.length >= total;
  let messageId = input.messageId;
  if (!messageId) {
    const [row] = await db
      .insert(adminMessages)
      .values({ kind: "email", audience: "list", title: input.subject, body: input.body.slice(0, 500), link: input.buttonUrl ?? null, recipients: total, delivered, createdBy: admin.email })
      .returning({ id: adminMessages.id });
    messageId = row.id;
    await auditLogEntry({ actorEmail: admin.email, action: "message.email", entityType: "message", entityId: messageId, detail: { mode: "list", subject: input.subject, recipients: total } });
  } else {
    await db.update(adminMessages).set({ delivered: sql`${adminMessages.delivered} + ${delivered}` }).where(eq(adminMessages.id, messageId));
  }
  return Response.json({ messageId, total, delivered, next: input.offset + rows.length, done });
}
