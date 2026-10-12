import { parseFilters } from "@/lib/catalog-filters";
import { CATALOG_PAGE_SIZE, countCatalogProducts, getCatalogProducts, toCard, type CatalogQuery } from "@/lib/commerce";

const MAX_PAGE = 200;

const SORTS = new Set(["newest", "low", "high"]);

/**
 * One page of the live catalogue as product cards, for the shop and collection pages' category tabs, sorting and
 * "Show more". Every distinct (category, sort, page) is cached at the edge for a minute, so a crowd of shoppers
 * costs the database one read per minute per page, not one per visitor.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cat = (params.get("cat") ?? "").trim();
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const sortParam = params.get("sort") ?? "newest";
  const page = Math.min(MAX_PAGE, Math.max(1, Number(params.get("page")) || 1));

  const scope: CatalogQuery = {
    categorySlug: /^[a-z0-9-]{1,80}$/.test(cat) && cat !== "all" ? cat : undefined,
    search: q || undefined,
    filters: parseFilters(params),
  };
  const sort = (SORTS.has(sortParam) ? sortParam : "newest") as CatalogQuery["sort"];

  const [items, total] = await Promise.all([
    getCatalogProducts({ ...scope, sort, limit: CATALOG_PAGE_SIZE, offset: (page - 1) * CATALOG_PAGE_SIZE }),
    countCatalogProducts(scope),
  ]);
  return Response.json(
    { products: items.map(toCard), total, page, pageSize: CATALOG_PAGE_SIZE },
    { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" } },
  );
}
