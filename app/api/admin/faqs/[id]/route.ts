import { eq } from "drizzle-orm";
import { db } from "@/db";
import { faqs } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";
import { faqSchema } from "@/lib/faqs";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return Response.json({ error: "Question not found." }, { status: 404 });
  const parsed = faqSchema.partial().safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid question." }, { status: 400 });
  const data = parsed.data;
  // a request that changes nothing must not write an audit entry or refresh the website
  if (data.question === undefined && data.answer === undefined && data.active === undefined) return Response.json({ error: "Nothing to change." }, { status: 400 });
  const [row] = await db
    .update(faqs)
    .set({ ...(data.question !== undefined ? { question: data.question } : {}), ...(data.answer !== undefined ? { answer: data.answer } : {}), ...(data.active !== undefined ? { active: data.active } : {}), updatedAt: new Date() })
    .where(eq(faqs.id, id))
    .returning();
  if (!row) return Response.json({ error: "Question not found." }, { status: 404 });
  await auditLogEntry({ actorEmail: admin.email, action: "faq.update", entityType: "faq", entityId: id, detail: { question: row.question } });
  return Response.json({ faq: row });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return Response.json({ error: "Question not found." }, { status: 404 });
  const [row] = await db.delete(faqs).where(eq(faqs.id, id)).returning();
  if (!row) return Response.json({ error: "Question not found." }, { status: 404 });
  await auditLogEntry({ actorEmail: admin.email, action: "faq.delete", entityType: "faq", entityId: id, detail: { question: row.question } });
  return Response.json({ ok: true });
}
