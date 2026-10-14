/**
 * Colours for the parts of the shop that frame every page: the header, the side menu, the footer, the currency picker and the phone
 * bottom bar. Each one is optional: an empty value keeps the built-in look. Values are validated as #rrggbb before they are ever written
 * into CSS, and a text colour that would be hard to read on its background (WCAG contrast below 4.5:1) is never applied.
 */
export const CHROME_KEYS = [
  "themeHeaderColor",
  "themeHeaderTextColor",
  "themeSidebarColor",
  "themeSidebarTextColor",
  "themeFooterColor",
  "themeFooterTextColor",
  "themeCurrencyColor",
  "themeCurrencyTextColor",
  "themeBottomBarColor",
  "themeBottomBarTextColor",
] as const;
export type ChromeKey = (typeof CHROME_KEYS)[number];
export type ChromeColors = Partial<Record<ChromeKey | "themeBackgroundColor", string | null | undefined>>;

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (value: string | null | undefined): value is string => typeof value === "string" && HEX.test(value);

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const MIN_CONTRAST = 4.5;
const DARK_TEXT = "#111111";
const LIGHT_TEXT = "#ffffff";

/**
 * The most readable text colour on a background: near-black or white, whichever has the higher contrast ratio. On the middle greys neither
 * reaches 4.5:1, so pure black is tried as well (some candidate always reaches it).
 */
export function readableOn(background: string): string {
  const best = contrastRatio(background, DARK_TEXT) >= contrastRatio(background, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
  if (contrastRatio(background, best) >= MIN_CONTRAST) return best;
  return contrastRatio(background, "#000000") >= contrastRatio(background, best) ? "#000000" : best;
}

/** What each area looks like when nothing is chosen (the built-in background the text colour would sit on). */
export const CHROME_DEFAULT_BG = { header: "#ffffff", sidebar: "#faf9f6", footer: "#0d0d0d", currency: "#ffffff" } as const;

/** True when the chosen text colour is readable on the background it will really sit on. */
export function textIsReadable(text: string, background: string): boolean {
  return isHexColor(text) && isHexColor(background) && contrastRatio(text, background) >= MIN_CONTRAST;
}

/**
 * The CSS for the chosen colours. When only a background is chosen, the text colour is picked for readability. A chosen text colour is used
 * only when it is readable on the effective background (the chosen one, or the built-in one). The brand picture in the header / footer is
 * a dark-on-light (or light-on-dark) image, so it is flipped to stay visible on the chosen background.
 */
export function chromeCss(colors: ChromeColors): string {
  const pick = (key: ChromeKey) => (isHexColor(colors[key]) ? (colors[key] as string) : "");
  const rules: string[] = [];

  /** Works out the background and text colour to apply for one area (empty strings = leave the built-in look alone). */
  const resolve = (bgKey: ChromeKey, inkKey: ChromeKey, builtInBg: string) => {
    const bg = pick(bgKey);
    const chosenInk = pick(inkKey);
    const effectiveBg = bg || builtInBg;
    const ink = chosenInk ? (textIsReadable(chosenInk, effectiveBg) ? chosenInk : bg ? readableOn(bg) : "") : bg ? readableOn(bg) : "";
    return { bg, ink, effectiveBg };
  };

  const header = resolve("themeHeaderColor", "themeHeaderTextColor", CHROME_DEFAULT_BG.header);
  if (header.bg) rules.push(`.site-header{background:${header.bg} !important;backdrop-filter:none !important}`);
  if (header.ink) rules.push(`.site-header,.site-header a,.site-header .icon-btn,.site-header .hdr-search-hint,.site-header .cart-count{color:${header.ink} !important}`);
  if (header.bg) rules.push(`.site-header .logo img{filter:${readableOn(header.bg) === LIGHT_TEXT ? "brightness(0) invert(1)" : "none"} !important}`);

  const side = resolve("themeSidebarColor", "themeSidebarTextColor", CHROME_DEFAULT_BG.sidebar);
  if (side.bg) rules.push(`.drawer{background:${side.bg} !important}`);
  if (side.ink) {
    rules.push(
      `.drawer,.drawer nav a,.drawer-nav-item,.drawer-cat-link,.drawer-title,.drawer-sub-link,.drawer-foot a,.drawer-close-btn,.drawer-expand-btn{color:${side.ink} !important}`,
      `.drawer-top,.drawer-foot,.drawer-group{border-color:color-mix(in srgb,${side.ink} 14%,transparent) !important}`,
      `.drawer nav a:hover,.drawer-nav-item:hover,.drawer-cat-row:hover,.drawer-expand-btn:hover{background:color-mix(in srgb,${side.ink} 8%,transparent) !important}`,
    );
  }

  const foot = resolve("themeFooterColor", "themeFooterTextColor", CHROME_DEFAULT_BG.footer);
  if (foot.bg) rules.push(`.footer{background:${foot.bg} !important}`);
  if (foot.ink) {
    rules.push(
      `.footer,.footer-brand p,.footer-links h3,.footer-links a,.footer-bottom,.footer-bottom a,.footer-social a{color:${foot.ink} !important}`,
      `.footer-social a,.footer-bottom{border-color:color-mix(in srgb,${foot.ink} 25%,transparent) !important}`,
    );
  }
  if (foot.bg) rules.push(`.footer-brand img{filter:${readableOn(foot.bg) === DARK_TEXT ? "brightness(0)" : "none"} !important}`);

  const cur = resolve("themeCurrencyColor", "themeCurrencyTextColor", CHROME_DEFAULT_BG.currency);
  if (cur.bg) rules.push(`.currency-switcher .currency-main,.currency-switcher ul{background:${cur.bg} !important}`);
  if (cur.ink) {
    rules.push(
      `.currency-switcher .currency-main,.currency-switcher ul,.currency-switcher li button,.currency-switcher li button b{color:${cur.ink} !important}`,
      `.currency-switcher li button span,.currency-switcher .currency-note{color:${cur.ink} !important}`, // opaque: a diluted colour can drop below 4.5:1
      `.currency-switcher li button:hover,.currency-switcher li button.active{background:color-mix(in srgb,${cur.ink} 10%,transparent) !important}`,
    );
  }

  // The phone bottom bar sits on the page colour unless it has its own.
  const pageBg = isHexColor(colors.themeBackgroundColor) ? colors.themeBackgroundColor : "#ffffff";
  const bar = resolve("themeBottomBarColor", "themeBottomBarTextColor", pageBg);
  if (bar.bg) rules.push(`.tab-bar{background:${bar.bg} !important;backdrop-filter:none !important}`, `.tab-search-bubble{border-color:${bar.bg} !important}`);
  if (bar.ink) {
    rules.push(
      `.tab-bar a,.tab-bar button,.tab-search-label{color:${bar.ink} !important}`,
      `.tab-bar a[aria-current="page"]::before{background:${bar.ink} !important}`,
    );
  }
  return rules.join("\n");
}
