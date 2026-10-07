import { variantKeyFor } from "./image-variants";

/**
 * Public image URLs. Product / category / campaign imagery lives in the Neon public bucket and is
 * served through Cloudflare's CDN:
 *   - NEXT_PUBLIC_CDN_URL set (e.g. https://cdn.nureasmir.com): a Cloudflare-proxied hostname whose
 *     origin rule points at the bucket — images never touch the Worker or the database.
 *   - unset: the same-origin /cdn/* route (app/cdn/[...key]/route.ts), which streams from the bucket
 *     through Cloudflare's edge cache. Works everywhere with zero configuration.
 *
 * The widths of the pre-generated WebP variants are carried in a `vw` query parameter
 * (e.g. `?vw=320.640.960`), so the next/image loader can pick the right file without a DB lookup.
 * Pure + dependency-free: safe to import from server and client components alike.
 */
/** Tolerates a value pasted as a markdown link, with quotes, spaces or a trailing slash; anything unusable means "/cdn". */
function cleanCdnBase(raw: string | undefined): string {
  const found = (raw ?? "").match(/https?:\/\/[a-z0-9.-]+(?::\d+)?/i);
  return found ? found[0] : "/cdn";
}
export const CDN_BASE = cleanCdnBase(process.env.NEXT_PUBLIC_CDN_URL);

export function mediaUrl(key: string, variantWidths?: number[] | null): string {
  return `${CDN_BASE}/${key}${variantWidths?.length ? `?vw=${variantWidths.join(".")}` : ""}`;
}

export function isCdnUrl(src: string): boolean {
  return src.startsWith(`${CDN_BASE}/`);
}

function parseCdnUrl(src: string): { key: string; widths: number[] } {
  const [path, query = ""] = src.split("?");
  const vw = new URLSearchParams(query).get("vw");
  const widths = vw
    ? vw.split(".").map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    : [];
  return { key: path.slice(CDN_BASE.length + 1), widths };
}

/** The best file for a requested render width: smallest variant >= width, else the largest. */
export function cdnSrcForWidth(src: string, width: number): string {
  const { key, widths } = parseCdnUrl(src);
  if (!widths.length) return `${CDN_BASE}/${key}`;
  // A file up to 20% narrower than asked is sharp enough once the browser scales it, and far lighter than jumping to the next size up.
  const picked = widths.find((w) => w >= width * 0.8) ?? widths[widths.length - 1];
  return `${CDN_BASE}/${variantKeyFor(key, picked)}`;
}

export function cdnSrcSet(src: string): string {
  const { key, widths } = parseCdnUrl(src);
  if (!widths.length) return "";
  return widths.map((w) => `${CDN_BASE}/${variantKeyFor(key, w)} ${w}w`).join(", ");
}
