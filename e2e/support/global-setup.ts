/**
 * Runs once before the suite, after the test server is up. `next dev` builds each page the first time it is asked for, which can take far longer than a
 * test is willing to wait (the suite no longer reuses a server that was already warm), so the pages and APIs the tests start with are requested here, with
 * plenty of time. Failures are ignored: this only warms things up.
 */
export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  const paths = [
    "/", "/shop", "/cart", "/checkout", "/faq", "/contact", "/policies/returns", "/robots.txt", "/sitemap.xml",
    "/api/checkout/options", "/api/catalog/page?cat=all&sort=newest&page=1", "/api/catalog/facets", "/api/search/index", "/api/geo/country",
    "/admin/login", "/collections/shirts", "/products/ivory-sashiko-tee",
  ];
  for (const path of paths) {
    await fetch(`${base}${path}`, { signal: AbortSignal.timeout(120_000) }).catch(() => undefined);
  }
}
