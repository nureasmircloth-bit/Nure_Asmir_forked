import { getSalePricesByIds } from "@/lib/commerce";

/** Current discounts for a few products (the search dropdown), so a search result shows the same "was / now" price as its page.
 * Search engines store the normal price, and a sale can start or end at any moment, so the live price is asked for separately. */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 12);
  if (!ids.length) return Response.json({ prices: {} });
  const prices = await getSalePricesByIds(ids).catch(() => ({}));
  return Response.json({ prices }, { headers: { "Cache-Control": "public, max-age=20, s-maxage=20, stale-while-revalidate=60" } });
}
