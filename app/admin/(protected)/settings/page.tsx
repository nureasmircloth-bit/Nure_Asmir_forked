import { groqKeys } from "@/lib/groq";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { pushConfigured } from "@/lib/push/fcm";
import { isTcsConfigured } from "@/lib/tcs";
import { PageHeader } from "../../_ui/ui";
import { SettingsForm, type SettingsValues, type SystemStatus } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  const values: SettingsValues = {
    brandName: row?.brandName ?? BRAND.name,
    supportPhone: row?.supportPhone || BRAND.contact.phone,
    whatsappNumber: row?.whatsappNumber || BRAND.contact.phone,
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
  };
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
  return (
    <>
      <PageHeader title="Settings" intro="Your shop details, delivery, payments and connections. Change what you need and press Save at the bottom." />
      <SettingsForm initial={values} status={status} />
    </>
  );
}
