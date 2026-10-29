/** One product as the storefront search needs it. Identical for every engine, so the UI never cares which one answered. */
export type SearchHit = {
  objectID: string;
  name: string;
  slug: string;
  price: number;
  /** True for "price on request" products (no price is shown). */
  priceOnRequest?: boolean;
  comingSoon?: boolean;
  imageUrl: string | null;
  category: string;
  /** Name with <mark> around the matched words (Algolia sends this; the local engine builds it). */
  highlight?: string;
};

export type SearchResult = { hits: SearchHit[]; total: number; engine: "algolia" | "local" };

/** The searchable record, as stored in Algolia and served to the local engine. */
export type SearchDoc = {
  objectID: string;
  name: string;
  slug: string;
  category: string;
  categorySlug: string;
  type: string;
  color: string;
  sizes: string[];
  price: number;
  priceOnRequest?: boolean;
  comingSoon?: boolean;
  inStock: boolean;
  badge: string;
  description: string;
  imageUrl: string | null;
  blurDataUrl: string | null;
  featured: boolean;
  publishedAt: number;
};
