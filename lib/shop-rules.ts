/**
 * The shop's own rules in one place, used by the website, the checkout and the server when it prices an order – so what the shopper
 * is told and what they are charged can never disagree. Pure functions: easy to test, no database.
 */
export type AnnouncementMode = "auto" | "custom" | "off";
/** How the top strip moves: one line at a time, or every line scrolling in a loop (to the left or to the right). */
export type AnnouncementStyle = "rotate" | "scroll-left" | "scroll-right";
export const isAnnouncementStyle = (value: unknown): value is AnnouncementStyle => value === "rotate" || value === "scroll-left" || value === "scroll-right";
export type DeliveryMode = "zones" | "flat" | "tcs";
export type PaymentMethod = "cod" | "bank_deposit";

export const isAnnouncementMode = (value: unknown): value is AnnouncementMode => value === "auto" || value === "custom" || value === "off";
export const isDeliveryMode = (value: unknown): value is DeliveryMode => value === "zones" || value === "flat" || value === "tcs";

const rupees = (amount: number) => `Rs. ${amount.toLocaleString("en-PK")}`;

/** The owner's own lines: one per line, trimmed, no empty lines, at most 6 of 140 characters. */
export function parseLines(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim().slice(0, 140))
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * What the strip at the top of every page says.
 *  - "auto": built from the real rules (cash on delivery, free delivery above the threshold) plus the owner's extra lines
 *  - "custom": only the owner's lines (falls back to the rules if they wrote none)
 *  - "off": nothing
 */
export function buildAnnouncements(input: { mode: AnnouncementMode; lines: string | null | undefined; freeDeliveryAbove: number; bankDepositEnabled: boolean }): string[] {
  if (input.mode === "off") return [];
  const own = parseLines(input.lines);
  if (input.mode === "custom" && own.length) return own;
  const rules = [
    "Cash on delivery available all over Pakistan",
    ...(input.bankDepositEnabled ? ["Pay by cash on delivery or bank transfer"] : []),
    ...(input.freeDeliveryAbove > 0 ? [`Free delivery on orders above ${rupees(input.freeDeliveryAbove)}`] : []),
  ];
  return [...rules, ...own];
}

/** Payment methods a shopper may choose. Cash on delivery is always offered; bank transfer only when the owner switches it on. */
export function allowedPaymentMethods(bankDepositEnabled: boolean): PaymentMethod[] {
  return bankDepositEnabled ? ["cod", "bank_deposit"] : ["cod"];
}

export function isPaymentAllowed(method: unknown, bankDepositEnabled: boolean): method is PaymentMethod {
  return (method === "cod" || method === "bank_deposit") && allowedPaymentMethods(bankDepositEnabled).includes(method);
}

/**
 * The delivery charge for one order, in rupees.
 *  - orders at or above `freeAbove` (when it is above 0) are free in every mode
 *  - "flat": the same price everywhere
 *  - "zones": the price of the shopper's area
 *  - "tcs": the TCS tariff for the city when it is known, otherwise the area's price (so a missing tariff never blocks an order)
 */
export function computeDeliveryCharge(input: { mode: DeliveryMode; subtotal: number; freeAbove: number; zoneCharge: number; flatCharge: number; tcsCharge?: number | null }): number {
  if (input.freeAbove > 0 && input.subtotal >= input.freeAbove) return 0;
  const clean = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (input.mode === "flat") return clean(input.flatCharge);
  if (input.mode === "tcs" && input.tcsCharge != null && Number.isFinite(input.tcsCharge)) return clean(input.tcsCharge);
  return clean(input.zoneCharge);
}

/** "Add Rs. 1,200 more for free delivery" – null when it is already free or there is no free-delivery rule. */
export function freeDeliveryHint(subtotal: number, freeAbove: number): string | null {
  if (!(freeAbove > 0) || subtotal >= freeAbove) return null;
  return `Add ${rupees(freeAbove - subtotal)} more to get free delivery`;
}
