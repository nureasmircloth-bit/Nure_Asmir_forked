/** Single source of truth for brand copy used outside the DB-backed site settings. */
export const BRAND = {
  name: "Nure Asmir",
  descriptor: "Men's Wear",
  tagline: "Tradition in a modern form",
  description:
    "Nure Asmir is a Pakistani men's wear label — shalwar kameez, shirts, pants and leather accessories, delivered nationwide with cash on delivery.",
  /** Used only when NEXT_PUBLIC_SITE_URL is not configured. */
  fallbackOrigin: "https://nureasmir.com",
  /** Shown as the sender name on transactional email / used in WhatsApp templates. */
  emailName: "Nure Asmir",
  /** Contact + social profiles shown when the owner has not typed their own in Settings. */
  contact: {
    phone: "+924236622241",
    whatsappPhone: "+923116111963",
    whatsappChatUrl: "https://wa.me/message/BW72H342EHB3E1",
    instagramUrl: "https://www.instagram.com/nureasmirofficial",
    facebookUrl: "https://www.facebook.com/share/1BYdatPDfZ/",
    tiktokUrl: "https://www.tiktok.com/@nure.asmir",
  },
} as const;

/** Turns whatever was typed into the site-address setting ("nureasmir.com", "https://nureasmir.com/") into a valid origin. */
export function normalizeOrigin(raw: string | undefined, fallback: string = BRAND.fallbackOrigin): string {
  // Tolerates quotes, spaces, a trailing slash or path, and a missing https:// (all seen in pasted settings).
  const cleaned = (raw ?? "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
  const match = cleaned.match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}|localhost)(:\d+)?/i);
  if (!match) return fallback;
  const scheme = /^http:\/\//i.test(cleaned) ? "http" : /^https:\/\//i.test(cleaned) ? "https" : match[1] === "localhost" ? "http" : "https";
  try {
    return new URL(`${scheme}://${match[1]}${match[2] ?? ""}`).origin;
  } catch {
    return fallback;
  }
}

export function siteOrigin(): string {
  return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
}
