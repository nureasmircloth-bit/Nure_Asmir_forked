/**
 * The "practice mode" switch: a signed cookie that says "this browser is practising until <time>". Web-crypto only, so it works in the
 * Worker entry, in middleware and in route handlers alike. Anyone can see the cookie, but nobody can make one up without the secret.
 */
export const PRACTICE_COOKIE = "na_practice";
/** How long one practice session lasts before the browser goes back to the real shop by itself. */
export const PRACTICE_MINUTES = 120;

const encoder = new TextEncoder();

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`practice:${payload}`)));
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex.slice(0, 40);
}

/** "<expiry in ms>.<signature>" */
export async function makePracticeCookie(secret: string, now = Date.now(), minutes = PRACTICE_MINUTES): Promise<{ value: string; expires: Date }> {
  const expires = new Date(now + minutes * 60_000);
  const payload = String(expires.getTime());
  return { value: `${payload}.${await sign(payload, secret)}`, expires };
}

export async function verifyPracticeCookie(value: string | null | undefined, secret: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!value || !secret) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !/^\d{10,15}$/.test(payload) || Number(payload) < now) return false;
  const expected = await sign(payload, secret);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Is this request from a browser that is currently practising? */
export async function requestIsPractising(request: { headers: { get(name: string): string | null } }, secret: string | null | undefined): Promise<boolean> {
  return verifyPracticeCookie(readCookie(request.headers.get("cookie"), PRACTICE_COOKIE), secret);
}
