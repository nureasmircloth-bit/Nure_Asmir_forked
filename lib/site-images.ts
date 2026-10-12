import { cache } from "react";
import { db } from "@/db";
import { siteImages } from "@/db/schema";
import { mediaUrl } from "@/lib/media-url";

/** Pictures the owner can swap from Admin → Website pictures (besides products, categories and home banners). */
export const SITE_IMAGE_SLOTS = [
  {
    slot: "about_hero",
    label: "Photo on the “Our story” page (Desktop)",
    help: "The big picture next to the story on desktop screens. A portrait photo works best.",
    size: "about 1200 × 1500 pixels (portrait 4:5)",
    fallback: "/cdn/products/seed-noir-kameez-shalwar-with-waistcoat-1-w960.webp",
    aspect: "4 / 5",
    isMobile: false,
  },
  {
    slot: "about_hero_mobile",
    label: "Mobile photo on the “Our story” page (Phone)",
    help: "Portrait photo shown to phone shoppers. Check the interactive mobile preview below to see how it fits.",
    size: "about 1080 × 1920 pixels (vertical 9:16)",
    fallback: "/cdn/products/seed-noir-kameez-shalwar-with-waistcoat-1-w960.webp",
    aspect: "9 / 16",
    isMobile: true,
  },
  {
    slot: "share_image",
    label: "Picture shown when someone shares your website link",
    help: "What people see when your link is sent on WhatsApp, Facebook or in Google results.",
    size: "1200 × 630 pixels (wide)",
    fallback: "/og.jpg",
    aspect: "1200 / 630",
    isMobile: false,
  },
] as const;
export type SiteImageSlot = (typeof SITE_IMAGE_SLOTS)[number]["slot"];

export function isSiteImageSlot(value: string): value is SiteImageSlot {
  return SITE_IMAGE_SLOTS.some((item) => item.slot === value);
}

export type SiteImage = { slot: string; url: string; originalKey: string; alt: string; blurDataUrl: string | null; updatedAt: number };

/** All owner-set pictures (usually zero, one or two rows). Never throws – the shop falls back to its built-in pictures. */
export const getSiteImages = cache(async (): Promise<Record<string, SiteImage>> => {
  try {
    const rows = await db.select().from(siteImages);
    return Object.fromEntries(
      rows.map((row) => [row.slot, { slot: row.slot, url: mediaUrl(row.r2Key, row.variantWidths), originalKey: row.r2Key, alt: row.altText, blurDataUrl: row.blurDataUrl, updatedAt: row.updatedAt.getTime() }]),
    );
  } catch (error) {
    console.error("site images lookup failed – using built-in pictures", error);
    return {};
  }
});
