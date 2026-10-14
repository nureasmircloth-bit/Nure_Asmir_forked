/**
 * Colours for the parts of the shop that frame every page: the header, the side menu, the footer and the currency picker.
 * Each one is optional: an empty value keeps the built-in look. The values are validated as #rrggbb before they are ever written into CSS.
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
] as const;
export type ChromeKey = (typeof CHROME_KEYS)[number];
export type ChromeColors = Partial<Record<ChromeKey, string | null | undefined>>;

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (value: string | null | undefined): value is string => typeof value === "string" && HEX.test(value);

/** Perceived brightness 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** A readable text colour for a background: black on light, white on dark. */
export const readableOn = (background: string): string => (luminance(background) > 0.6 ? "#111111" : "#ffffff");

/**
 * The CSS for the chosen colours. When only a background is chosen, the text colour is picked for readability. The brand picture in the
 * header / footer is a dark-on-light (or light-on-dark) image, so it is flipped to stay visible on the chosen background.
 */
export function chromeCss(colors: ChromeColors): string {
  const pick = (key: ChromeKey) => (isHexColor(colors[key]) ? (colors[key] as string) : "");
  const rules: string[] = [];

  const headerBg = pick("themeHeaderColor");
  const headerInk = pick("themeHeaderTextColor") || (headerBg ? readableOn(headerBg) : "");
  if (headerBg) rules.push(`.site-header{background:${headerBg} !important;backdrop-filter:none !important}`);
  if (headerInk) rules.push(`.site-header,.site-header a,.site-header .icon-btn,.site-header .hdr-search-hint,.site-header .cart-count{color:${headerInk} !important}`);
  if (headerBg) rules.push(`.site-header .logo img{filter:${luminance(headerBg) < 0.45 ? "brightness(0) invert(1)" : "none"} !important}`);

  const sideBg = pick("themeSidebarColor");
  const sideInk = pick("themeSidebarTextColor") || (sideBg ? readableOn(sideBg) : "");
  if (sideBg) rules.push(`.drawer{background:${sideBg} !important}`);
  if (sideInk) {
    rules.push(
      `.drawer,.drawer nav a,.drawer-nav-item,.drawer-cat-link,.drawer-title,.drawer-sub-link,.drawer-foot a,.drawer-close-btn,.drawer-expand-btn{color:${sideInk} !important}`,
      `.drawer-top,.drawer-foot,.drawer-group{border-color:color-mix(in srgb,${sideInk} 14%,transparent) !important}`,
      `.drawer nav a:hover,.drawer-nav-item:hover,.drawer-cat-row:hover,.drawer-expand-btn:hover{background:color-mix(in srgb,${sideInk} 8%,transparent) !important}`,
    );
  }

  const footBg = pick("themeFooterColor");
  const footInk = pick("themeFooterTextColor") || (footBg ? readableOn(footBg) : "");
  if (footBg) rules.push(`.footer{background:${footBg} !important}`);
  if (footInk) {
    rules.push(
      `.footer,.footer-brand p,.footer-links h3,.footer-links a,.footer-bottom,.footer-bottom a,.footer-social a{color:${footInk} !important}`,
      `.footer-social a,.footer-bottom{border-color:color-mix(in srgb,${footInk} 25%,transparent) !important}`,
    );
  }
  if (footBg) rules.push(`.footer-brand img{filter:${luminance(footBg) > 0.6 ? "brightness(0)" : "none"} !important}`);

  const curBg = pick("themeCurrencyColor");
  const curInk = pick("themeCurrencyTextColor") || (curBg ? readableOn(curBg) : "");
  if (curBg) rules.push(`.currency-switcher .currency-main,.currency-switcher ul{background:${curBg} !important}`);
  if (curInk) {
    rules.push(
      `.currency-switcher .currency-main,.currency-switcher ul,.currency-switcher li button,.currency-switcher li button b{color:${curInk} !important}`,
      `.currency-switcher li button span,.currency-switcher .currency-note{color:color-mix(in srgb,${curInk} 65%,transparent) !important}`,
      `.currency-switcher li button:hover,.currency-switcher li button.active{background:color-mix(in srgb,${curInk} 10%,transparent) !important}`,
    );
  }
  return rules.join("\n");
}
