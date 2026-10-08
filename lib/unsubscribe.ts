/** Signed "unsubscribe" links for marketing emails: the link proves it was made by us for that address, so nobody can unsubscribe a stranger. */
const encoder = new TextEncoder();

async function sign(email: string): Promise<string> {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_SESSION_SECRET || "";
  if (!secret) return "";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`unsubscribe:${email.toLowerCase()}`)));
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex.slice(0, 32);
}

export async function unsubscribeToken(email: string): Promise<string> {
  return sign(email);
}

export async function verifyUnsubscribeToken(email: string, token: string): Promise<boolean> {
  const expected = await sign(email);
  if (!expected || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function unsubscribeUrl(origin: string, email: string): Promise<string> {
  return `${origin}/unsubscribe?e=${encodeURIComponent(email)}&t=${await unsubscribeToken(email)}`;
}
