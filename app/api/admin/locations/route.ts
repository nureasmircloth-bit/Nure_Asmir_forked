import { asc, count, ne } from "drizzle-orm";
import { sandboxRoomMessage } from "@/lib/sandbox";
import { db } from "@/db";
import { storeLocations } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";
import { locationSchema, MAX_LOCATIONS } from "@/lib/locations";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.select().from(storeLocations).orderBy(asc(storeLocations.sortOrder), asc(storeLocations.createdAt));
  return Response.json({ locations: rows });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const full = await sandboxRoomMessage("locations"); // practice shop only: a small limit on how much can be created
  if (full) return Response.json({ error: full }, { status: 400 });

  const parsed = locationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid shop details." }, { status: 400 });
  const data = parsed.data;

  const [{ n }] = await db.select({ n: count() }).from(storeLocations);
  if (n >= MAX_LOCATIONS) return Response.json({ error: `You can list up to ${MAX_LOCATIONS} shops.` }, { status: 400 });

  const makeMain = data.isMain === true || n === 0;
  const [row] = await db
    .insert(storeLocations)
    .values({
      name: data.name,
      address: data.address,
      city: data.city,
      phone: data.phone,
      hours: data.hours,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      isMain: makeMain,
      active: data.active ?? true,
      sortOrder: n,
    })
    .returning();
  if (makeMain) await db.update(storeLocations).set({ isMain: false }).where(ne(storeLocations.id, row.id));

  await auditLogEntry({ actorEmail: admin.email, action: "location.create", entityType: "location", entityId: row.id, detail: { name: row.name } });
  return Response.json({ location: row }, { status: 201 });
}
