/**
 * The fonts the owner can pick in Settings → Storefront theme. Every font is a Google Font that is loaded by name; `weights` is what that
 * font really offers. Asking Google for a weight a font does not have makes the whole request fail (the font silently never loads), so the
 * request below only ever lists weights from this table.
 */
export type FontKind = "serif" | "sans" | "display";
export type FontChoice = { value: string; label: string; kind: FontKind; weights: string };

const ALL = "400;500;600;700";
const REGULAR_BOLD = "400;700";
const REGULAR = "400";

export const DISPLAY_FONTS: FontChoice[] = [
  { value: "Cormorant Garamond", label: "Cormorant Garamond — classic luxury serif (default)", kind: "serif", weights: ALL },
  { value: "Playfair Display", label: "Playfair Display — high-fashion editorial", kind: "serif", weights: ALL },
  { value: "Cinzel", label: "Cinzel — royal Roman capitals", kind: "serif", weights: ALL },
  { value: "Bodoni Moda", label: "Bodoni Moda — haute couture", kind: "serif", weights: ALL },
  { value: "Cormorant", label: "Cormorant — delicate display serif", kind: "serif", weights: ALL },
  { value: "EB Garamond", label: "EB Garamond — timeless book serif", kind: "serif", weights: ALL },
  { value: "Fraunces", label: "Fraunces — soft, characterful serif", kind: "serif", weights: ALL },
  { value: "Crimson Pro", label: "Crimson Pro — warm reading serif", kind: "serif", weights: ALL },
  { value: "Lora", label: "Lora — contemporary editorial serif", kind: "serif", weights: ALL },
  { value: "Spectral", label: "Spectral — refined screen serif", kind: "serif", weights: ALL },
  { value: "Libre Baskerville", label: "Libre Baskerville — heritage serif", kind: "serif", weights: REGULAR_BOLD },
  { value: "Old Standard TT", label: "Old Standard TT — vintage newspaper serif", kind: "serif", weights: REGULAR_BOLD },
  { value: "Cardo", label: "Cardo — scholarly classic serif", kind: "serif", weights: REGULAR_BOLD },
  { value: "Rufina", label: "Rufina — sharp, elegant serif", kind: "serif", weights: REGULAR_BOLD },
  { value: "Prata", label: "Prata — refined Didone", kind: "serif", weights: REGULAR },
  { value: "Marcellus", label: "Marcellus — Roman proportions", kind: "serif", weights: REGULAR },
  { value: "DM Serif Display", label: "DM Serif Display — modern high contrast", kind: "serif", weights: REGULAR },
  { value: "Gloock", label: "Gloock — bold high-contrast serif", kind: "display", weights: REGULAR },
  { value: "Abril Fatface", label: "Abril Fatface — fat-face headline", kind: "display", weights: REGULAR },
  { value: "Yeseva One", label: "Yeseva One — graceful display serif", kind: "display", weights: REGULAR },
  { value: "Rozha One", label: "Rozha One — heavy, dramatic serif", kind: "display", weights: REGULAR },
  { value: "Italiana", label: "Italiana — Italian Vogue elegance", kind: "display", weights: REGULAR },
  { value: "Tenor Sans", label: "Tenor Sans — humanist luxury sans", kind: "sans", weights: REGULAR },
  { value: "Josefin Sans", label: "Josefin Sans — vintage geometric sans", kind: "sans", weights: ALL },
  { value: "Syne", label: "Syne — avant-garde sans", kind: "sans", weights: ALL },
  { value: "Space Grotesk", label: "Space Grotesk — quirky modern sans", kind: "sans", weights: ALL },
  { value: "Inter", label: "Inter — ultra-clean modern sans", kind: "sans", weights: ALL },
  { value: "Outfit", label: "Outfit — minimalist geometric sans", kind: "sans", weights: ALL },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans — contemporary premium sans", kind: "sans", weights: ALL },
  { value: "Montserrat", label: "Montserrat — architectural sans", kind: "sans", weights: ALL },
  { value: "Poppins", label: "Poppins — friendly geometric sans", kind: "sans", weights: ALL },
  { value: "Raleway", label: "Raleway — elegant light-feel sans", kind: "sans", weights: ALL },
];

export const BODY_FONTS: FontChoice[] = [
  { value: "Jost", label: "Jost — clean geometric sans (default)", kind: "sans", weights: ALL },
  { value: "Inter", label: "Inter — crisp modern UI sans", kind: "sans", weights: ALL },
  { value: "DM Sans", label: "DM Sans — low-contrast geometric sans", kind: "sans", weights: ALL },
  { value: "Manrope", label: "Manrope — modern semi-condensed sans", kind: "sans", weights: ALL },
  { value: "Outfit", label: "Outfit — contemporary minimalist", kind: "sans", weights: ALL },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans — warm executive sans", kind: "sans", weights: ALL },
  { value: "Figtree", label: "Figtree — friendly and neat", kind: "sans", weights: ALL },
  { value: "Montserrat", label: "Montserrat — editorial sans", kind: "sans", weights: ALL },
  { value: "Poppins", label: "Poppins — balanced modern geometric sans", kind: "sans", weights: ALL },
  { value: "Raleway", label: "Raleway — elegant light-feel sans", kind: "sans", weights: ALL },
  { value: "Lato", label: "Lato — classic neutral sans", kind: "sans", weights: REGULAR_BOLD },
  { value: "Open Sans", label: "Open Sans — familiar and readable", kind: "sans", weights: ALL },
  { value: "Roboto", label: "Roboto — neutral, everywhere-readable", kind: "sans", weights: ALL },
  { value: "Source Sans 3", label: "Source Sans 3 — clear and professional", kind: "sans", weights: ALL },
  { value: "Nunito Sans", label: "Nunito Sans — clean soft sans", kind: "sans", weights: ALL },
  { value: "Work Sans", label: "Work Sans — grotesque editorial sans", kind: "sans", weights: ALL },
  { value: "Mulish", label: "Mulish — minimalist, very legible", kind: "sans", weights: ALL },
  { value: "Karla", label: "Karla — quirky grotesque sans", kind: "sans", weights: ALL },
  { value: "IBM Plex Sans", label: "IBM Plex Sans — technical and sturdy", kind: "sans", weights: ALL },
  { value: "Public Sans", label: "Public Sans — strong, neutral sans", kind: "sans", weights: ALL },
  { value: "Barlow", label: "Barlow — slightly rounded, sporty sans", kind: "sans", weights: ALL },
  { value: "Be Vietnam Pro", label: "Be Vietnam Pro — contemporary sans", kind: "sans", weights: ALL },
  { value: "system-ui", label: "System font — fastest, matches the visitor's device", kind: "sans", weights: "" },
];

/** Fonts for the Contact page: the readable sans fonts plus the heading serif the shop already uses. */
export const CONTACT_FONTS: FontChoice[] = [
  { value: "Inter", label: "Inter — simple and ultra-crisp (recommended)", kind: "sans", weights: ALL },
  ...BODY_FONTS.filter((font) => font.value !== "Inter" && font.value !== "system-ui" && font.value !== "Jost"),
  { value: "Jost", label: "Jost — the shop's body font", kind: "sans", weights: ALL },
  { value: "Cormorant Garamond", label: "Cormorant Garamond — match the luxury serif", kind: "serif", weights: ALL },
  { value: "system-ui", label: "System font — fastest, matches the visitor's device", kind: "sans", weights: "" },
];

const KNOWN = new Map<string, FontChoice>([...DISPLAY_FONTS, ...BODY_FONTS, ...CONTACT_FONTS].map((font) => [font.value, font]));

/** The address of the Google Fonts stylesheet for one font, or null for the system font / an empty name. Only weights the font has are asked for. */
export function googleFontHref(name: string | null | undefined, display = "swap"): string | null {
  const clean = (name ?? "").trim();
  if (!clean || clean === "system-ui") return null;
  const weights = KNOWN.get(clean)?.weights;
  const family = encodeURIComponent(clean).replace(/%20/g, "+");
  // A font that is not in the table (an older, hand-typed name) is asked for without weights, which every font accepts.
  return `https://fonts.googleapis.com/css2?family=${family}${weights ? `:wght@${weights}` : ""}&display=${display}`;
}

/** The list to show in a select: the table, plus the current value when it is an older name that is not in the table. */
export function withCurrent(list: FontChoice[], current: string): FontChoice[] {
  if (!current || list.some((font) => font.value === current)) return list;
  return [...list, { value: current, label: `${current} — current font`, kind: "sans", weights: "" }];
}
