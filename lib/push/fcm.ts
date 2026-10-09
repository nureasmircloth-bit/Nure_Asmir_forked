import { isPracticeRequest } from "@/lib/practice-context";
import { trackedFetch } from "@/lib/usage";
/**
 * Firebase Cloud Messaging (HTTP v1) sender for Cloudflare Workers.
 *
 * Auth is a Google service account (env FIREBASE_SERVICE_ACCOUNT = the JSON key, as one line): we
 * sign a short-lived JWT with WebCrypto (RS256), exchange it for an OAuth access token and cache it
 * until shortly before it expires. No firebase-admin SDK (far too heavy for a Worker).
 */
// FCM_BASE_URL / GOOGLE_OAUTH_TOKEN_URL exist only so the e2e suite can point this sender at a local
// mock (e2e/support/mock-fcm.mjs); production uses the Google defaults.
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cached: { token: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount | null {
  if (isPracticeRequest()) return null; // the practice shop never sends a real notification
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    return parsed.client_email && parsed.private_key && parsed.project_id ? parsed : null;
  } catch {
    return null;
  }
}

export function pushConfigured(): boolean {
  if (isPracticeRequest()) return false; // the practice shop never sends a real notification
  return loadServiceAccount() !== null;
}

function base64Url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = account.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64Url(signature)}`;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await trackedFetch("fcm", process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signJwt(account) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Google OAuth responded ${response.status}`);
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || typeof json.expires_in !== "number") throw new Error("Google OAuth response was missing access_token / expires_in");
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Where a click on the notification should go (same-origin path). */
  url?: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
};

// FCM data messages are capped at 4 KB in total — clip every user-influenced string well below that
// so a long customer name can never turn into a rejected message.
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Outcome of one send. "dead" is reserved for a token FCM positively says is no longer registered. */
export type SendResult = "ok" | "dead" | "error";

/** Decides, from FCM's error body, whether the *token* is permanently invalid (vs. a bad payload, a
 * wrong project or a transient failure — none of which may cost a device its registration). */
export function isDeadTokenResponse(status: number, body: string): boolean {
  let errorCode = "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; details?: Array<{ errorCode?: string }> } };
    errorCode = parsed.error?.details?.find((detail) => detail.errorCode)?.errorCode ?? "";
    message = parsed.error?.message ?? "";
  } catch {
    return false;
  }
  if (errorCode === "UNREGISTERED") return true;
  // INVALID_ARGUMENT is also returned for malformed payloads, so only count it when FCM names the token.
  return status === 400 && errorCode === "INVALID_ARGUMENT" && /registration token|not a valid FCM/i.test(message);
}

/** Sends one notification to one device token. */
export async function sendPush(deviceToken: string, payload: PushPayload): Promise<SendResult> {
  const account = loadServiceAccount();
  if (!account) return "error";
  try {
    const response = await trackedFetch("fcm", `${process.env.FCM_BASE_URL || "https://fcm.googleapis.com"}/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(account)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          // Data-only: the service worker (public/firebase-messaging-sw.js) builds the notification.
          data: {
            title: clip(payload.title, 120),
            body: clip(payload.body, 400),
            url: clip(payload.url ?? "/admin/orders", 300),
            ...(payload.tag ? { tag: clip(payload.tag, 100) } : {}),
          },
          webpush: { headers: { Urgency: "high", TTL: "86400" } },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) return "ok";
    const text = await response.text().catch(() => "");
    if (isDeadTokenResponse(response.status, text)) return "dead";
    console.error("FCM send failed", response.status, text.slice(0, 300));
    return "error";
  } catch (error) {
    console.error("FCM send threw", error);
    return "error";
  }
}
