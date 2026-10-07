/**
 * Display-only currency conversion backed by Frankfurter (https://frankfurter.dev, no API key).
 * Orders are always priced and charged in PKR — converted figures are an approximation shown to
 * international shoppers, which is why checkout keeps showing the PKR amount.
 *
 * Rates are fetched with USD as the base (Frankfurter rounds each quote to ~5 significant
 * digits, and PKR is a tiny-value quote against most currencies), then cross-multiplied.
 */
export const BASE_CURRENCY = "PKR";

export const CURRENCIES = [
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs.", locale: "en-PK", digits: 0 },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US", digits: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB", digits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", locale: "de-DE", digits: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "AED", locale: "en-AE", digits: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "SAR", locale: "en-SA", digits: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", locale: "en-CA", digits: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-AU", digits: 2 },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

/** Units of each currency per 1 PKR. */
export type RatesPerPkr = Partial<Record<CurrencyCode, number>>;

export type RatesPayload = { date: string; rates: RatesPerPkr; fetchedAt: number };

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && CURRENCIES.some((c) => c.code === value);
}

/** Server-side: pulls USD-based quotes from Frankfurter and converts them to "per 1 PKR". */
export async function fetchRates(): Promise<RatesPayload> {
  const quotes = CURRENCIES.map((c) => c.code).join(",");
  const response = await fetch(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=${quotes}`, {
    headers: { Accept: "application/json" },
    // Frankfurter is free and external: never let a slow response hold a Worker request open.
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Frankfurter responded ${response.status}`);
  const rows = (await response.json()) as Array<{ date: string; quote: string; rate: number }>;
  const perUsd = new Map(rows.map((row) => [row.quote, row.rate]));
  perUsd.set("USD", 1);
  const pkrPerUsd = perUsd.get("PKR");
  if (!pkrPerUsd) throw new Error("Frankfurter returned no PKR quote");

  const rates: RatesPerPkr = { PKR: 1 };
  for (const { code } of CURRENCIES) {
    const value = perUsd.get(code);
    if (value) rates[code] = value / pkrPerUsd;
  }
  return { date: rows[0]?.date ?? "", rates, fetchedAt: Date.now() };
}

export function formatPrice(amountPkr: number, currency: CurrencyCode, rates: RatesPerPkr | null): string {
  const meta = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];
  const rate = currency === BASE_CURRENCY ? 1 : rates?.[currency];
  // No rate yet (first paint / offline): always fall back to the real PKR price.
  const useCurrency = rate ? meta : CURRENCIES[0];
  const value = amountPkr * (rate ?? 1);
  if (useCurrency.code === "PKR") return `Rs. ${Math.round(value).toLocaleString("en-PK")}`;
  return new Intl.NumberFormat(useCurrency.locale, {
    style: "currency",
    currency: useCurrency.code,
    minimumFractionDigits: useCurrency.digits,
    maximumFractionDigits: useCurrency.digits,
  }).format(value);
}

/* ---- flags + "start on the shopper's own currency" ---- */

const EUROZONE = new Set(["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"]);

/** The currency to start on for a visitor from `country` (ISO code). Pakistan → PKR; countries we have a currency for get theirs; anywhere else → USD. */
export function currencyForCountry(country: string | null | undefined): CurrencyCode {
  const code = (country ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "PK") return BASE_CURRENCY;
  if (EUROZONE.has(code)) return "EUR";
  const direct: Record<string, CurrencyCode> = { US: "USD", GB: "GBP", AE: "AED", SA: "SAR", CA: "CAD", AU: "AUD" };
  return direct[code] ?? "USD";
}

/** Two-letter flag code for each currency, for the flag pictures (Windows cannot draw flag emoji, so pictures are used). */
export const FLAG_OF: Record<CurrencyCode, string> = { PKR: "pk", USD: "us", GBP: "gb", EUR: "eu", AED: "ae", SAR: "sa", CAD: "ca", AUD: "au" };
/** The flags are our own files (public/flags): one less outside website a visitor's router has to look up before the page can finish. */
export const flagSrc = (code: CurrencyCode) => `/flags/${FLAG_OF[code]}.svg`;
