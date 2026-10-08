import { getActiveCategories, getCategoryDiscounts, getPublicSettings } from "@/lib/commerce";
import { buildAnnouncements, isAnnouncementMode, isAnnouncementStyle } from "@/lib/shop-rules";
import { HeaderClient } from "./header-client";

/** Server wrapper: feeds the (client) header the live category list and shipping threshold, so the
 * menu always reflects what's configured in the admin panel. The header is the same
 * white bar on every page. */
export async function StoreHeader() {
  const [categories, settings, discounts] = await Promise.all([getActiveCategories(), getPublicSettings(), getCategoryDiscounts().catch(() => new Map<string, number>())]);
  return (
    <HeaderClient
      categories={categories.map((category) => ({ name: category.name, slug: category.slug, discount: discounts.get(category.id) }))}
      messages={buildAnnouncements({
        mode: isAnnouncementMode(settings.announcementMode) ? settings.announcementMode : "auto",
        lines: settings.announcementLines,
        freeDeliveryAbove: settings.freeDeliveryThreshold,
        bankDepositEnabled: settings.bankDepositEnabled,
      })}
      announcementStyle={isAnnouncementStyle(settings.announcementStyle) ? settings.announcementStyle : "rotate"}
      whatsappNumber={settings.whatsappNumber}
    />
  );
}
