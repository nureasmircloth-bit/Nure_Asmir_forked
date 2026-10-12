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
  themeAccentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).or(z.literal("")).optional(),
  themePreset: z.string().max(40).optional(),
  themeBackgroundColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).or(z.literal("")).optional(),
  themeTextColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).or(z.literal("")).optional(),
  themeSurfaceColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).or(z.literal("")).optional(),
  themeRadius: z.enum(["sharp", "subtle", "rounded", "pill"]).optional(),
  fontFamily: z.string().regex(/^[a-zA-Z0-9\s\-',]+$/).max(80).or(z.literal("")).optional(),
  bodyFontFamily: z.string().regex(/^[a-zA-Z0-9\s\-',]+$/).max(80).or(z.literal("")).optional(),
  contactFontFamily: z.string().regex(/^[a-zA-Z0-9\s\-',]+$/).max(80).or(z.literal("")).optional(),
});

/** Accepts the bare code or the whole <meta …> tag the search engine shows, and keeps only the code. */
function cleanVerification(value: string): string {
  const fromTag = /content\s*=\s*["']([^"']+)["']/i.exec(value)?.[1];
  return (fromTag ?? value).trim().replace(/[^A-Za-z0-9_\-.]/g, "").slice(0, 120);
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  let pending: { changes: Record<string, unknown>; applyAt: string; remainingSeconds: number } | null = null;

  if (row?.pendingApplyAt && row.pendingChanges) {
    const applyAtTime = new Date(row.pendingApplyAt).getTime();
    const now = Date.now();
    if (applyAtTime <= now) {
      try {
        const changes = JSON.parse(row.pendingChanges);
        const [updated] = await db
          .update(siteSettings)
          .set({
            ...changes,
            pendingChanges: null,
            pendingApplyAt: null,
            previousSettings: null,
            updatedAt: new Date(),
          })
          .where(eq(siteSettings.id, "store"))
          .returning();
        if (updated) row = updated;
      } catch {
        // ignore parse error
      }
    } else {
      try {
        pending = {
          changes: JSON.parse(row.pendingChanges),
          applyAt: new Date(row.pendingApplyAt).toISOString(),
          remainingSeconds: Math.max(0, Math.ceil((applyAtTime - now) / 1000)),
        };
      } catch {
        // ignore parse error
      }
    }
  }

  return Response.json({ settings: row ?? null, pending });
}

export async function PATCH(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await request.json().catch(() => ({}));

  // Action 1: Revert pending changes
  if (raw?.action === "revert") {
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
    if (!row?.pendingChanges) {
      return Response.json({ message: "No pending changes to revert.", settings: row ?? null, pending: null });
    }
    const [updated] = await db
      .update(siteSettings)
      .set({
        pendingChanges: null,
        pendingApplyAt: null,
        previousSettings: null,
        updatedAt: new Date(),
      })
      .where(eq(siteSettings.id, "store"))
      .returning();
    await auditLogEntry({ actorEmail: admin.email, action: "settings.revert", entityType: "site-settings", entityId: "store", detail: { reverted: true } });
    return Response.json({ settings: updated, pending: null, reverted: true });
  }

  // Action 2: Apply pending changes immediately
  if (raw?.action === "apply-now") {
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
    if (!row?.pendingChanges) {
      return Response.json({ message: "No pending changes to apply.", settings: row ?? null, pending: null });
    }
    const changes = JSON.parse(row.pendingChanges);
    const [updated] = await db
      .update(siteSettings)
      .set({
        ...changes,
        pendingChanges: null,
        pendingApplyAt: null,
        previousSettings: null,
        updatedAt: new Date(),
      })
      .where(eq(siteSettings.id, "store"))
      .returning();
    await auditLogEntry({ actorEmail: admin.email, action: "settings.apply-immediate", entityType: "site-settings", entityId: "store", detail: changes });
    return Response.json({ settings: updated, pending: null, applied: true });
  }

  const parsed = updateSchema.safeParse(raw);
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
    ...(data.themeAccentColor !== undefined ? { themeAccentColor: data.themeAccentColor } : {}),
    ...(data.themePreset !== undefined ? { themePreset: data.themePreset } : {}),
    ...(data.themeBackgroundColor !== undefined ? { themeBackgroundColor: data.themeBackgroundColor } : {}),
    ...(data.themeTextColor !== undefined ? { themeTextColor: data.themeTextColor } : {}),
    ...(data.themeSurfaceColor !== undefined ? { themeSurfaceColor: data.themeSurfaceColor } : {}),
    ...(data.themeRadius !== undefined ? { themeRadius: data.themeRadius } : {}),
    ...(data.fontFamily !== undefined ? { fontFamily: data.fontFamily } : {}),
    ...(data.bodyFontFamily !== undefined ? { bodyFontFamily: data.bodyFontFamily } : {}),
    ...(data.contactFontFamily !== undefined ? { contactFontFamily: data.contactFontFamily } : {}),
  };

  const [currentRow] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);

  if (raw?.immediate === true) {
    const fullValues = {
      ...values,
      pendingChanges: null,
      pendingApplyAt: null,
      previousSettings: null,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(siteSettings)
      .values({ id: "store", ...fullValues })
      .onConflictDoUpdate({ target: siteSettings.id, set: fullValues })
      .returning();

    await auditLogEntry({ actorEmail: admin.email, action: "settings.update", entityType: "site-settings", entityId: "store", detail: data });
    return Response.json({ settings: row, pending: null });
  }

  // 5-minute safety buffer before applying changes to live site
  const bufferMs = 5 * 60 * 1000;
  const applyAt = new Date(Date.now() + bufferMs);
  const pendingData = JSON.stringify(values);
  const previousData = currentRow ? JSON.stringify(currentRow) : null;

  const [row] = await db
    .insert(siteSettings)
    .values({
      id: "store",
      pendingChanges: pendingData,
      pendingApplyAt: applyAt,
      previousSettings: previousData,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: siteSettings.id,
      set: {
        pendingChanges: pendingData,
        pendingApplyAt: applyAt,
        previousSettings: previousData,
        updatedAt: new Date(),
      },
    })
    .returning();

  await auditLogEntry({ actorEmail: admin.email, action: "settings.buffered-update", entityType: "site-settings", entityId: "store", detail: { ...data, applyAt } });

  return Response.json({
    settings: currentRow ?? row,
    pending: {
      changes: values,
      applyAt: applyAt.toISOString(),
      remainingSeconds: 300,
    },
  });
}
