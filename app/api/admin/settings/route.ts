import { parseLines } from "@/lib/shop-rules";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { cleanPhone } from "@/lib/slug";
import { auditLogEntry } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/** Only web addresses are kept; a bare "instagram.com/name" gets https:// in front. Anything else is dropped. */
function cleanUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

const updateSchema = z.object({
  brandName: z.string().min(1).optional(),
  whatsappNumber: z.string().optional(),
  supportPhone: z.string().optional(),
  supportEmail: z.string().optional(),
  instagramUrl: z.string().max(300).optional(),
  facebookUrl: z.string().max(300).optional(),
  tiktokUrl: z.string().max(300).optional(),
  whatsappChatUrl: z.string().max(300).optional(),
  tcsShipperName: z.string().max(60).optional(),
  tcsShipperAddress: z.string().max(240).optional(),
  tcsShipperCityName: z.string().max(60).optional(),
  tcsShipperCityCode: z.string().max(8).optional(),
  tcsShipperPhone: z.string().max(30).optional(),
  refundWindowDays: z.coerce.number().int().min(0).max(60).optional(),
  soldoutHideDays: z.coerce.number().int().min(0).max(3650).optional(),
  googleSiteVerification: z.string().trim().max(120).optional(),
  announcementMode: z.enum(["auto", "custom", "off"]).optional(),
  announcementLines: z.string().max(1200).optional(),
  announcementStyle: z.enum(["rotate", "scroll-left", "scroll-right"]).optional(),
  aboutHeading: z.string().trim().max(120).optional(),
  aboutBody: z.string().max(6000).optional(),
  bankDepositEnabled: z.boolean().optional(),
  deliveryMode: z.enum(["zones", "flat", "tcs"]).optional(),
  flatDeliveryCharge: z.coerce.number().int().min(0).max(100000).optional(),
  bingSiteVerification: z.string().trim().max(120).optional(),
  bankName: z.string().optional(),
  bankAccountTitle: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankIban: z.string().optional(),
  metaPixelId: z.string().optional(),
  gaMeasurementId: z.string().optional(),
  freeDeliveryThreshold: z.coerce.number().int().min(0).optional(),
  codReservationHours: z.coerce.number().int().min(1).optional(),
  bankReservationHours: z.coerce.number().int().min(1).optional(),
  taxEnabled: z.boolean().optional(),
});

/** Accepts the bare code or the whole <meta …> tag the search engine shows, and keeps only the code. */
function cleanVerification(value: string): string {
  const fromTag = /content\s*=\s*["']([^"']+)["']/i.exec(value)?.[1];
  return (fromTag ?? value).trim().replace(/[^A-Za-z0-9_\-.]/g, "").slice(0, 120);
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  return Response.json({ settings: row ?? null });
}

export async function PATCH(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid settings payload." }, { status: 400 });
  const data = parsed.data;

  const values = {
    ...(data.brandName !== undefined ? { brandName: data.brandName } : {}),
    ...(data.whatsappNumber !== undefined ? { whatsappNumber: cleanPhone(data.whatsappNumber) } : {}),
    ...(data.supportPhone !== undefined ? { supportPhone: cleanPhone(data.supportPhone) } : {}),
    ...(data.supportEmail !== undefined ? { supportEmail: data.supportEmail } : {}),
    ...(data.instagramUrl !== undefined ? { instagramUrl: cleanUrl(data.instagramUrl) } : {}),
    ...(data.facebookUrl !== undefined ? { facebookUrl: cleanUrl(data.facebookUrl) } : {}),
    ...(data.tiktokUrl !== undefined ? { tiktokUrl: cleanUrl(data.tiktokUrl) } : {}),
    ...(data.whatsappChatUrl !== undefined ? { whatsappChatUrl: cleanUrl(data.whatsappChatUrl) } : {}),
    ...(data.tcsShipperName !== undefined ? { tcsShipperName: data.tcsShipperName.trim() } : {}),
    ...(data.tcsShipperAddress !== undefined ? { tcsShipperAddress: data.tcsShipperAddress.trim() } : {}),
    ...(data.tcsShipperCityName !== undefined ? { tcsShipperCityName: data.tcsShipperCityName.trim() } : {}),
    ...(data.tcsShipperCityCode !== undefined ? { tcsShipperCityCode: data.tcsShipperCityCode.trim().toUpperCase() } : {}),
    ...(data.tcsShipperPhone !== undefined ? { tcsShipperPhone: cleanPhone(data.tcsShipperPhone) } : {}),
    ...(data.refundWindowDays !== undefined ? { refundWindowDays: data.refundWindowDays } : {}),
    ...(data.soldoutHideDays !== undefined ? { soldoutHideDays: data.soldoutHideDays } : {}),
    ...(data.announcementMode !== undefined ? { announcementMode: data.announcementMode } : {}),
    ...(data.announcementStyle !== undefined ? { announcementStyle: data.announcementStyle } : {}),
    ...(data.aboutHeading !== undefined ? { aboutHeading: data.aboutHeading } : {}),
    ...(data.aboutBody !== undefined ? { aboutBody: data.aboutBody.trim() } : {}),
    ...(data.announcementLines !== undefined ? { announcementLines: parseLines(data.announcementLines).join("\n") } : {}),
    ...(data.bankDepositEnabled !== undefined ? { bankDepositEnabled: data.bankDepositEnabled } : {}),
    ...(data.deliveryMode !== undefined ? { deliveryMode: data.deliveryMode } : {}),
    ...(data.flatDeliveryCharge !== undefined ? { flatDeliveryCharge: data.flatDeliveryCharge } : {}),
    ...(data.googleSiteVerification !== undefined ? { googleSiteVerification: cleanVerification(data.googleSiteVerification) } : {}),
    ...(data.bingSiteVerification !== undefined ? { bingSiteVerification: cleanVerification(data.bingSiteVerification) } : {}),
    ...(data.bankName !== undefined ? { bankName: data.bankName } : {}),
    ...(data.bankAccountTitle !== undefined ? { bankAccountTitle: data.bankAccountTitle } : {}),
    ...(data.bankAccountNumber !== undefined ? { bankAccountNumber: data.bankAccountNumber } : {}),
    ...(data.bankIban !== undefined ? { bankIban: data.bankIban } : {}),
    ...(data.metaPixelId !== undefined ? { metaPixelId: data.metaPixelId } : {}),
    ...(data.gaMeasurementId !== undefined ? { gaMeasurementId: data.gaMeasurementId } : {}),
    ...(data.freeDeliveryThreshold !== undefined ? { freeDeliveryThreshold: data.freeDeliveryThreshold } : {}),
    ...(data.codReservationHours !== undefined ? { codReservationHours: data.codReservationHours } : {}),
    ...(data.bankReservationHours !== undefined ? { bankReservationHours: data.bankReservationHours } : {}),
    ...(data.taxEnabled !== undefined ? { taxEnabled: data.taxEnabled } : {}),
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(siteSettings)
    .values({ id: "store", ...values })
    .onConflictDoUpdate({ target: siteSettings.id, set: values })
    .returning();

  await auditLogEntry({ actorEmail: admin.email, action: "settings.update", entityType: "site-settings", entityId: "store", detail: data });

  return Response.json({ settings: row });
}
