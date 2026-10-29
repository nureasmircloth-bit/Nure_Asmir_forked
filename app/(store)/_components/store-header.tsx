import { getActiveCategories, getCategoryDiscounts, getPublicSettings } from "@/lib/commerce";
import { buildAnnouncements, isAnnouncementMode, isAnnouncementStyle } from "@/lib/shop-rules";
import { topLevel } from "@/lib/category-tree";
import { HeaderClient, type NavNode } from "./header-client";

/** Server wrapper: feeds the (client) header the live category list and shipping threshold, so the
 * menu always reflects what's configured in the admin panel. The header is the same
 * white bar on every page. */
type Entry = Awaited<ReturnType<typeof getActiveCategories>>[number];

export async function StoreHeader() {
  const [categories, settings, discounts] = await Promise.all([getActiveCategories(), getPublicSettings(), getCategoryDiscounts().catch(() => new Map<string, number>())]);
  // The menu is the category tree: every category carries the ones inside it (deeper levels too), cut off after a few levels as a safety net.
  const kidsOf = new Map<string, Entry[]>();
  for (const category of categories) if (category.parentId) kidsOf.set(category.parentId, [...(kidsOf.get(category.parentId) ?? []), category]);
  const toNav = (category: Entry, depth = 0): NavNode => ({
    name: category.name,
    slug: category.slug,
    subcategories: category.subcategories,
    discount: discounts.get(category.id),
    kids: depth < 5 ? (kidsOf.get(category.id) ?? []).map((kid) => toNav(kid, depth + 1)) : [],
  });
  return (
    <HeaderClient
      categories={topLevel(categories).map((category) => toNav(category))}
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
