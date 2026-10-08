import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminMessages, adminPushDevices, customerPushDevices, subscribers } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { emailAllowance } from "@/lib/email/transport";
import { pushConfigured } from "@/lib/push/fcm";

export const dynamic = "force-dynamic";

/** What the Messages page needs to know: who can be reached, what is left of today's free emails, and what was sent recently. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [[devices], [alerts], [mine], [list], allowance, history] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(customerPushDevices),
    db.select({ n: sql<number>`count(*)::int` }).from(customerPushDevices).where(eq(customerPushDevices.salesOptIn, true)),
    db.select({ n: sql<number>`count(*)::int` }).from(adminPushDevices),
    db.select({ n: sql<number>`count(*)::int` }).from(subscribers).where(eq(subscribers.status, "subscribed")),
    emailAllowance(),
    db.select().from(adminMessages).orderBy(desc(adminMessages.createdAt)).limit(15),
  ]);
  return Response.json({
    pushReady: pushConfigured(),
    devices: devices?.n ?? 0,
    saleAlertDevices: alerts?.n ?? 0,
    adminDevices: mine?.n ?? 0,
    subscribers: list?.n ?? 0,
    allowance,
    history,
  });
}
