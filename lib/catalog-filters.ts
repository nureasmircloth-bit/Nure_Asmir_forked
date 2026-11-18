/**
 * Shop filters (price range, sizes, colours, in stock only), read safely from a web address. Used by the catalogue API and the shop page,
 * so what the shopper picks, what is sent, and what the database is asked can never drift apart. Pure: no database, no network.
 */
export type CatalogFilters = {
  /** Lowest / highest price in rupees (either may be missing). */
  min?: number;
  max?: number;
  sizes: string[];
  colors: string[];
  inStock: boolean;
};

export const MAX_PRICE = 1_000_000;
const MAX_VALUES = 12;

export const EMPTY_FILTERS: CatalogFilters = { sizes: [], colors: [], inStock: false };

const cleanWord = (value: string) => value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);

/** "S,M, XL" → ["S","M","XL"] – trimmed, no empties, no repeats (ignoring case), at most 12. */
export function parseList(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(value ?? "").split(",")) {
    const word = cleanWord(part);
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_VALUES) break;
  }
  return out;
}

function parsePrice(value: string | null | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? Math.min(number, MAX_PRICE) : undefined;
}

export function parseFilters(params: URLSearchParams): CatalogFilters {
  let min = parsePrice(params.get("min"));
  let max = parsePrice(params.get("max"));
  if (min != null && max != null && min > max) [min, max] = [max, min]; // typed the wrong way round: be kind
  return { min, max, sizes: parseList(params.get("sizes")), colors: parseList(params.get("colors")), inStock: params.get("stock") === "1" };
}

/** The same filters as the parameters of a web address (only the ones that are set). */
export function filtersToParams(filters: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.min != null) params.set("min", String(filters.min));
  if (filters.max != null) params.set("max", String(filters.max));
  if (filters.sizes.length) params.set("sizes", filters.sizes.join(","));
  if (filters.colors.length) params.set("colors", filters.colors.join(","));
  if (filters.inStock) params.set("stock", "1");
  return params;
}

export function hasFilters(filters: CatalogFilters): boolean {
  return filters.min != null || filters.max != null || filters.sizes.length > 0 || filters.colors.length > 0 || filters.inStock;
}

/** How many separate filters are switched on (for the "Filters (3)" button). */
export function countFilters(filters: CatalogFilters): number {
  return (filters.min != null || filters.max != null ? 1 : 0) + (filters.sizes.length ? 1 : 0) + (filters.colors.length ? 1 : 0) + (filters.inStock ? 1 : 0);
}

/** Size names in the order a shopper expects: XS S M L XL XXL, then waist numbers, then anything else. */
const SIZE_ORDER = ["XXS", "XS", "S", "M", "MC", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL"];
/** Where a size belongs in the usual order (S, M, MC, L, XL...); waist numbers come after the letters, anything unknown last. */
export function sizeRank(size: string | null | undefined): number {
  if (!size) return 2000;
  const key = size.trim().toUpperCase();
  const index = SIZE_ORDER.indexOf(key);
  if (index >= 0) return index;
  const numeric = parseFloat(key);
  return Number.isNaN(numeric) ? 1000 : 100 + numeric;
}
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
}
