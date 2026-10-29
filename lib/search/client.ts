// Browser search: Algolia first, the built-in free engine only if Algolia refuses (free allowance used up)
// or cannot be reached. The built-in engine and the product list it needs are loaded on demand, so while
// Algolia works they cost shoppers nothing.

import { liteClient } from "algoliasearch/lite";
import { isQuotaError } from "./quota";
import type { SearchHit, SearchResult } from "./types";

const APP_ID = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
const SEARCH_KEY = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY;
const INDEX = process.env.NEXT_PUBLIC_ALGOLIA_INDEX_NAME || "nure_asmir_products";
// Emergency switch: set NEXT_PUBLIC_SEARCH_ENGINE=local to bypass Algolia completely.
const FORCED_LOCAL = process.env.NEXT_PUBLIC_SEARCH_ENGINE === "local";

const algolia = APP_ID && SEARCH_KEY ? liteClient(APP_ID, SEARCH_KEY) : null;

const FLAG_KEY = "na-search-local-until";
const QUOTA_MS = 30 * 60 * 1000; // allowance exhausted: stay on the built-in engine for 30 minutes
const HICCUP_MS = 2 * 60 * 1000; // network trouble: 2 minutes

let memoryUntil = 0;

function localUntil(): number {
  try {
    return Number(window.localStorage.getItem(FLAG_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function switchToLocalFor(ms: number) {
  memoryUntil = Date.now() + ms;
  try {
    window.localStorage.setItem(FLAG_KEY, String(memoryUntil));
  } catch {
    // private mode – the in-memory flag above still covers this page view
  }
}

/** Tells the server one browser search was sent to Algolia (for the developer page's allowance counter). Fire-and-forget. */
function countAlgoliaSearch(ok: boolean) {
  try {
    navigator.sendBeacon("/api/usage/ping", new Blob([JSON.stringify({ service: "algolia", ok })], { type: "application/json" }));
  } catch {
    // counting is optional
  }
}

type LocalEngine = { search: (query: string, limit: number) => { hits: SearchHit[]; total: number } };
let localEngine: Promise<LocalEngine> | null = null;

function loadLocalEngine(): Promise<LocalEngine> {
  localEngine ??= (async () => {
    const [{ buildLocalIndex, searchLocal }, response] = await Promise.all([import("./local"), fetch("/api/search/index")]);
    if (!response.ok) throw new Error(`Search index unavailable (${response.status})`);
    const index = buildLocalIndex(await response.json());
    return { search: (query: string, limit: number) => searchLocal(index, query, limit) };
  })().catch((error) => {
    localEngine = null; // let the next keystroke retry
    throw error;
  });
  return localEngine;
}

type AlgoliaHit = { objectID: string; name: string; slug: string; price: number; priceOnRequest?: boolean; comingSoon?: boolean; imageUrl: string | null; category: string; _highlightResult?: { name?: { value: string } } };

export async function searchProducts(term: string, limit = 8): Promise<SearchResult> {
  const useLocal = FORCED_LOCAL || !algolia || Date.now() < Math.max(localUntil(), memoryUntil);
  if (!useLocal && algolia) {
    try {
      const response = await algolia.search<AlgoliaHit>({
        requests: [
          {
            indexName: INDEX,
            query: term,
            hitsPerPage: limit,
            attributesToRetrieve: ["name", "slug", "price", "priceOnRequest", "comingSoon", "imageUrl", "category"],
            attributesToHighlight: ["name"],
            highlightPreTag: "<mark>",
            highlightPostTag: "</mark>",
          },
        ],
      });
      countAlgoliaSearch(true);
      const result = response.results[0] as { hits: AlgoliaHit[]; nbHits?: number };
      return {
        engine: "algolia",
        total: result.nbHits ?? result.hits.length,
        hits: result.hits.map((hit) => ({ objectID: hit.objectID, name: hit.name, slug: hit.slug, price: hit.price, priceOnRequest: Boolean(hit.priceOnRequest), comingSoon: Boolean(hit.comingSoon), imageUrl: hit.imageUrl, category: hit.category, highlight: hit._highlightResult?.name?.value })),
      };
    } catch (error) {
      countAlgoliaSearch(false);
      switchToLocalFor(isQuotaError(error) ? QUOTA_MS : HICCUP_MS);
    }
  }
  const engine = await loadLocalEngine();
  return { engine: "local", ...engine.search(term, limit) };
}
