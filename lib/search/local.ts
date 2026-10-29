// The free, built-in search engine used only when Algolia's free allowance runs out or Algolia is
// unreachable. It is a dynamic import everywhere (see client.ts / server.ts), so shoppers never download it
// – or the product list it searches – while Algolia is working.

import MiniSearch from "minisearch";
import type { SearchDoc, SearchHit } from "./types";

// Kameez / shalwar / tee are spelled many ways in Pakistan – fold the common ones together (the same
// equivalences the Algolia index has as synonyms in lib/search/algolia.ts).
const FOLD: Record<string, string> = {
  qameez: "kameez",
  kurta: "kameez",
  kurtah: "kameez",
  salwar: "shalwar",
  tshirt: "tee",
  "t-shirt": "tee",
  trousers: "pants",
  pant: "pants",
  cargo: "pants",
  waistcoat: "vest",
  gilet: "vest",
  bifold: "wallet",
  purse: "wallet",
  cardholder: "wallet",
};

const fold = (term: string): string => FOLD[term] ?? term;

export function buildLocalIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const index = new MiniSearch<SearchDoc>({
    idField: "objectID",
    fields: ["name", "type", "category", "color", "description", "sizesText"],
    storeFields: ["name", "slug", "price", "priceOnRequest", "comingSoon", "imageUrl", "category"],
    extractField: (doc, field) => (field === "sizesText" ? doc.sizes.join(" ") : String((doc as unknown as Record<string, unknown>)[field] ?? "")),
    processTerm: (term) => fold(term.toLowerCase()),
    searchOptions: { boost: { name: 3, type: 2, category: 1.5 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
  });
  index.addAll(docs);
  return index;
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(name: string, queryTerms: string[]): string {
  const safe = escapeHtml(name);
  const words = queryTerms.map((term) => term.replace(/[^\p{L}\p{N}]/gu, "")).filter((term) => term.length > 1);
  if (!words.length) return safe;
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return safe.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}

export function searchLocal(index: MiniSearch<SearchDoc>, query: string, limit: number): { hits: SearchHit[]; total: number } {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let results = index.search(query);
  // "AND" is precise; if it finds nothing, relax to any word so a typo in one word still shows something.
  if (!results.length && terms.length > 1) results = index.search(query, { combineWith: "OR" });
  const hits = results.slice(0, limit).map((result) => ({
    objectID: String(result.id),
    name: String(result.name),
    slug: String(result.slug),
    price: Number(result.price),
    // (the index's extractField turns every stored value into text, so false arrives as "false")
    priceOnRequest: result.priceOnRequest === true || result.priceOnRequest === "true",
    comingSoon: result.comingSoon === true || result.comingSoon === "true",
    imageUrl: (result.imageUrl as string | null) ?? null,
    category: String(result.category),
    highlight: highlight(String(result.name), terms),
  }));
  return { hits, total: results.length };
}
