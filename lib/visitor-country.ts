/**
 * Which country the visitor's connection is in, as two capital letters, or null when the host does not say (or says "unknown").
 *
 * On Cloudflare the edge sets `CF-IPCountry` itself and overwrites anything the visitor sent, so it is the one to trust. `x-vercel-ip-country` only exists
 * on Vercel; on Cloudflare a visitor could send it, so it is used only when there is no Cloudflare header at all (the old Vercel host, local tests).
 */
export function visitorCountry(headers: Headers): string | null {
  const read = (name: string): string | null => {
    const value = (headers.get(name) ?? "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(value) && value !== "XX" ? value : null; // XX = unknown; Tor ("T1") is not two letters and is ignored too
  };
  if (headers.has("cf-ipcountry")) return read("cf-ipcountry");
  return read("x-vercel-ip-country");
}
