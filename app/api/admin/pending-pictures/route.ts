import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { pendingPictures } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";

export const dynamic = "force-dynamic";

/**
 * Crosses pictures off the “waiting” list of the new products (the admin page “Pictures for new products” calls this once the pictures were saved on their products).
 * Only the rows named are removed; nothing else is touched.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) : [];
  if (!ids.length || ids.length > 90) return Response.json({ error: "Send between 1 and 90 picture ids." }, { status: 400 });
  await db.delete(pendingPictures).where(inArray(pendingPictures.id, ids));
  return Response.json({ ok: true, removed: ids.length });
}
