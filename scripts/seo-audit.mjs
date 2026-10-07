// Read-only SEO audit of the live site: every sitemap address plus the other public pages, then every internal link found.
// Usage: node scripts/seo-audit.mjs [https://nureasmir.com]   (about 70 requests; safe to run any time)
const ORIGIN = (process.argv[2] || "https://nureasmir.com").replace(/\/$/, "");
const get = async (url, opts = {}) => {
  try {
    const r = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; nure-audit/1.0)" }, ...opts });
    return { r, text: r.status < 300 || r.status >= 400 ? await r.text() : "" };
  } catch (e) {
    return { r: { status: 0, headers: new Headers() }, text: "", error: String(e) };
  }
};
const sitemap = (await get(`${ORIGIN}/sitemap.xml`)).text;
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const extra of ["/search", "/track-order", "/cart", "/checkout", "/wishlist", "/does-not-exist"]) if (!urls.includes(ORIGIN + extra)) urls.push(ORIGIN + extra);

const rows = [];
const links = new Map();
for (const url of urls) {
  const { r, text } = await get(url);
  const t = (re) => (re.exec(text) || [])[1];
  const title = t(/<title>([^<]*)<\/title>/);
  const desc = t(/<meta name="description" content="([^"]*)"/);
  const canonical = t(/<link rel="canonical" href="([^"]*)"/);
  const robots = t(/<meta name="robots" content="([^"]*)"/);
  const h1 = (text.match(/<h1[\s>]/g) || []).length;
  const ld = [...text.matchAll(/"@type":"([A-Za-z]+)"/g)].map((m) => m[1]);
  const imgs = [...text.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const noAlt = imgs.filter((i) => !/\balt=/.test(i)).length;
  const crumbs = /aria-label="Breadcrumb"|class="breadcrumb|aria-label="breadcrumb"/i.test(text);
  const hreflang = /hreflang=/.test(text);
  const lang = t(/<html lang="([^"]*)"/);
  for (const m of text.matchAll(/<a\b[^>]*href="([^"#]+)"/g)) {
    let h = m[1];
    if (h.startsWith("//") || /^(mailto|tel|javascript|whatsapp):/.test(h)) continue;
    if (h.startsWith("/")) h = ORIGIN + h;
    if (!links.has(h)) links.set(h, url);
  }
  rows.push({ path: url.replace(ORIGIN, "") || "/", status: r.status, title: title ? title.length : 0, desc: desc ? desc.length : 0, canon: canonical ? (canonical === url ? "self" : "OTHER:" + canonical) : "none", robots: robots || "-", h1, ld: [...new Set(ld)].join("/") || "-", noAlt, crumbs, hreflang, lang });
}
console.log("PATH".padEnd(44), "ST", "titleLen", "descLen", "canonical".padEnd(8), "robots".padEnd(14), "h1", "noAlt", "crumbs", "JSON-LD types");
for (const x of rows) console.log(x.path.slice(0, 43).padEnd(44), String(x.status).padEnd(3), String(x.title).padEnd(8), String(x.desc).padEnd(7), x.canon.padEnd(8), x.robots.padEnd(14), String(x.h1).padEnd(2), String(x.noAlt).padEnd(5), String(x.crumbs).padEnd(6), x.ld);
console.log("lang attr:", [...new Set(rows.map((r) => r.lang))].join(","), " hreflang on any page:", rows.some((r) => r.hreflang));

// every distinct internal link found, checked once
const internal = [...links.keys()].filter((l) => l.startsWith(ORIGIN) && !l.includes("/_next/") && !l.includes("/cdn/") && !l.includes("/api/"));
const bad = [];
for (const l of internal) {
  const { r } = await get(l, { method: "GET" });
  if (r.status >= 300) bad.push(`${r.status} ${l.replace(ORIGIN, "")}  (found on ${links.get(l).replace(ORIGIN, "") || "/"}) -> ${r.headers.get("location") || ""}`);
}
console.log(`\ninternal links checked: ${internal.length}; not 2xx: ${bad.length}`);
for (const b of bad) console.log("  ", b);
const external = [...links.keys()].filter((l) => !l.startsWith(ORIGIN));
console.log("external links:", external.length);
for (const l of external.slice(0, 20)) {
  const { r } = await get(l, { method: "HEAD" });
  if (r.status >= 400 || r.status === 0) console.log("  external problem:", r.status, l);
}
