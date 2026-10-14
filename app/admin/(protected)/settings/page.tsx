import { groqKeys } from "@/lib/groq";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { pushConfigured } from "@/lib/push/fcm";
import { isTcsConfigured } from "@/lib/tcs";
import { applyDuePendingSettings } from "@/lib/commerce";
import { PageHeader } from "../../_ui/ui";
import { SettingsForm, type SettingsValues, type SystemStatus } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

async function loadSettingsData() {
  let [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  const applied = await applyDuePendingSettings(row);
  if (applied) row = applied;

  let initialPending: { changes: Partial<SettingsValues>; applyAt: string; remainingSeconds: number } | null = null;
  if (row?.pendingApplyAt && row.pendingChanges) {
    const applyAtTime = new Date(row.pendingApplyAt).getTime();
    const now = Date.now();
    if (applyAtTime > now) {
      try {
        initialPending = {
          changes: JSON.parse(row.pendingChanges),
          applyAt: new Date(row.pendingApplyAt).toISOString(),
          remainingSeconds: Math.max(0, Math.ceil((applyAtTime - now) / 1000)),
        };
      } catch {}
    }
  }

  const values: SettingsValues = {
    brandName: row?.brandName ?? BRAND.name,
    supportPhone: row?.supportPhone || BRAND.contact.phone,
    whatsappNumber: row?.whatsappNumber || BRAND.contact.whatsappPhone || "+923116111963",
    whatsappChatUrl: row?.whatsappChatUrl || BRAND.contact.whatsappChatUrl,
    supportEmail: row?.supportEmail ?? "",
    instagramUrl: row?.instagramUrl || BRAND.contact.instagramUrl,
    facebookUrl: row?.facebookUrl || BRAND.contact.facebookUrl,
    tiktokUrl: row?.tiktokUrl || BRAND.contact.tiktokUrl,
    tcsShipperName: row?.tcsShipperName ?? "Nure Asmir",
    tcsShipperAddress: row?.tcsShipperAddress ?? "",
    tcsShipperCityName: row?.tcsShipperCityName ?? "Karachi",
    tcsShipperCityCode: row?.tcsShipperCityCode ?? "KHI",
    tcsShipperPhone: row?.tcsShipperPhone || BRAND.contact.phone,
    bankName: row?.bankName ?? "",
    bankAccountTitle: row?.bankAccountTitle ?? "",
    bankAccountNumber: row?.bankAccountNumber ?? "",
    bankIban: row?.bankIban ?? "",
    freeDeliveryThreshold: row?.freeDeliveryThreshold ?? 4000,
    codReservationHours: row?.codReservationHours ?? 6,
    bankReservationHours: row?.bankReservationHours ?? 6,
    refundWindowDays: row?.refundWindowDays ?? 7,
    soldoutHideDays: row?.soldoutHideDays ?? 90,
    announcementMode: row?.announcementMode ?? "auto",
    announcementLines: row?.announcementLines ?? "",
    announcementStyle: row?.announcementStyle ?? "rotate",
    bankDepositEnabled: row?.bankDepositEnabled ?? false,
    deliveryMode: row?.deliveryMode ?? "zones",
    flatDeliveryCharge: row?.flatDeliveryCharge ?? 250,
    googleSiteVerification: row?.googleSiteVerification ?? "",
    bingSiteVerification: row?.bingSiteVerification ?? "",
    metaPixelId: row?.metaPixelId ?? "",
    gaMeasurementId: row?.gaMeasurementId ?? "",
    themeAccentColor: row?.themeAccentColor || "#c5a059",
    themePreset: row?.themePreset || "signature",
    themeBackgroundColor: row?.themeBackgroundColor || "#ffffff",
    themeTextColor: row?.themeTextColor || "#111111",
    themeSurfaceColor: row?.themeSurfaceColor || "#faf9f6",
    themeRadius: row?.themeRadius || "subtle",
    fontFamily: row?.fontFamily || "Cormorant Garamond",
    bodyFontFamily: row?.bodyFontFamily || "Jost",
    contactFontFamily: row?.contactFontFamily || "Inter",
    shopDescription: row?.shopDescription ?? "",
    newsletterTitle: row?.newsletterTitle ?? "",
    newsletterText: row?.newsletterText ?? "",
  };

  // The form shows what is waiting to go live, so saving again never throws those waiting changes away.
  if (initialPending) Object.assign(values, initialPending.changes);

  const status: SystemStatus = {
    tcs: isTcsConfigured(),
    tcsLive: process.env.TCS_ENV === "production",
    push: pushConfigured(),
    search: Boolean(process.env.ALGOLIA_ADMIN_KEY),
    email: Boolean(process.env.RESEND_API_KEY),
    whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    writer: groqKeys().length > 0,
    spamShield: Boolean(process.env.TURNSTILE_SECRET_KEY),
  };

  return { values, initialPending, status };
}

export default async function SettingsPage() {
  const { values, initialPending, status } = await loadSettingsData();

  return (
    <>
      <PageHeader title="Settings" intro="Your shop details, delivery, payments and connections. Change what you need and press Save at the bottom." />
      <SettingsForm initial={values} status={status} initialPending={initialPending} />
    </>
  );
}
