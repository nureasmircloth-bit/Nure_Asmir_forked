import { visitorCountry } from "@/lib/visitor-country";

export const dynamic = "force-dynamic";

/**
 * Which country is the visitor in? The host tells us for free on every request (Vercel: `x-vercel-ip-country`; the Cloudflare Worker:
 * `CF-IPCountry`) – no outside service, no tracking. Used once, to start the currency selector on the shopper's own currency. Never cached for others.
 */
export async function GET(request: Request) {
  const country = visitorCountry(request.headers);
  return Response.json({ country }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
