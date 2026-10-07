import type { MetadataRoute } from "next";
import { getActiveCategories, getActiveCollections, getCatalogProducts } from "@/lib/commerce";
import { siteOrigin } from "@/lib/brand";

const POLICY_SLUGS = ["shipping", "returns", "privacy", "terms"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const [products, collections, categories] = await Promise.all([getCatalogProducts(), getActiveCollections(), getActiveCategories()]);
  const now = new Date();

  return [
    { url: origin, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/shop`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${origin}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${origin}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${origin}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...categories.map((category) => ({
      url: `${origin}/collections/${category.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...collections
      .filter((collection) => !categories.some((category) => category.slug === collection.slug))
      .map((collection) => ({
      url: `${origin}/collections/${collection.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: `${origin}/products/${product.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...POLICY_SLUGS.map((slug) => ({
      url: `${origin}/policies/${slug}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
