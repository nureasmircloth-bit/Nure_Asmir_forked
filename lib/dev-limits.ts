import type { ServiceName } from "@/lib/usage";

/**
 * What each outside service lets this shop use for free, and which settings switch it on. The numbers are the published free
 * allowances (they can change – a service's own page is the final word); where a service reports its real remaining allowance in
 * response headers (Groq, Resend) the developer page shows that instead.
 */
export type ServiceInfo = {
  label: string;
  /** What the free allowance counts, and how often it resets. */
  period: "day" | "month" | "none";
  limit: number | null;
  unit: string;
  /** Environment names that must be set for the service to work (names only – values are never shown). */
  keys: string[];
  note?: string;
  dashboard?: string;
};

export const SERVICES: Record<ServiceName, ServiceInfo> = {
  algolia: { label: "Algolia (search)", period: "month", limit: 10_000, unit: "requests", keys: ["ALGOLIA_APP_ID", "ALGOLIA_ADMIN_KEY", "NEXT_PUBLIC_ALGOLIA_SEARCH_KEY"], note: "When it runs out, the built-in search takes over by itself.", dashboard: "https://dashboard.algolia.com" },
  groq: { label: "Groq (“Write it for me”)", period: "day", limit: 14_400, unit: "requests", keys: ["GROQ_API_KEY"], note: "The real remaining number from Groq is shown below when it has reported one.", dashboard: "https://console.groq.com" },
  "groq-2": { label: "Groq – key 2", period: "day", limit: 14_400, unit: "requests", keys: ["GROQ_API_KEY_2"], note: "Keys are used in turn so each one's allowance lasts.", dashboard: "https://console.groq.com" },
  "groq-3": { label: "Groq – key 3", period: "day", limit: 14_400, unit: "requests", keys: ["GROQ_API_KEY_3"], note: "Keys are used in turn so each one's allowance lasts.", dashboard: "https://console.groq.com" },
  "resend-2": { label: "Resend – second account", period: "day", limit: 100, unit: "emails", keys: ["RESEND_API_KEY_2"], note: "Used automatically when the first account's daily allowance is used up. Optional.", dashboard: "https://resend.com" },
  brevo: { label: "Brevo (backup emails)", period: "day", limit: 300, unit: "emails", keys: ["BREVO_API_KEY"], note: "Free: 300 emails a day. Used when Resend is full or down. Optional.", dashboard: "https://app.brevo.com" },
  resend: { label: "Resend (emails)", period: "day", limit: 100, unit: "emails", keys: ["RESEND_API_KEY"], note: "Free plan: 100 a day and 3,000 a month.", dashboard: "https://resend.com" },
  geoapify: { label: "Geoapify (address search)", period: "day", limit: 3_000, unit: "lookups", keys: ["GEOAPIFY_API_KEY"], note: "Each address lookup is one request; answers are cached for a day.", dashboard: "https://myprojects.geoapify.com" },
  tcs: { label: "TCS (parcels)", period: "none", limit: null, unit: "requests", keys: ["TCS_USERNAME", "TCS_PASSWORD", "TCS_ACCOUNT_NO"], note: "No published limit.", dashboard: "https://www.tcsexpress.com" },
  fcm: { label: "Firebase (order alerts)", period: "none", limit: null, unit: "messages", keys: ["FIREBASE_SERVICE_ACCOUNT"], note: "Free without a limit.", dashboard: "https://console.firebase.google.com" },
  whatsapp: { label: "WhatsApp Business", period: "month", limit: 1_000, unit: "conversations", keys: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_TEMPLATE_NAME", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"], note: "Meta gives 1,000 free service conversations a month; messages that start a conversation are paid.", dashboard: "https://business.facebook.com/wa/manage" },
  turnstile: { label: "Cloudflare Turnstile (fake-order shield)", period: "none", limit: null, unit: "checks", keys: ["TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY"], note: "Free without a limit.", dashboard: "https://dash.cloudflare.com" },
  "neon-storage": { label: "Neon Storage (requests)", period: "none", limit: null, unit: "requests", keys: ["AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], note: "Pictures are served from Cloudflare's cache, so the store itself is rarely asked.", dashboard: "https://console.neon.tech" },
  "r2-storage": { label: "Cloudflare R2 (requests)", period: "month", limit: 1_000_000, unit: "requests", keys: [], note: "Free: 1 million writes and 10 million reads a month. Reads are cached at the edge.", dashboard: "https://dash.cloudflare.com/?to=/:account/r2" },
};

/** Other keys the site needs that are not a counted service. */
export const OTHER_KEYS: Array<{ label: string; keys: string[] }> = [
  { label: "Sign-in sessions", keys: ["SESSION_SECRET", "ADMIN_EMAIL"] },
  { label: "Scheduled jobs", keys: ["CRON_SECRET"] },
  { label: "Error reporting (Sentry browser)", keys: ["NEXT_PUBLIC_SENTRY_DSN"] },
];

export const DB_LIMIT_BYTES = 500 * 1024 * 1024; // Cloudflare D1 free plan: 500 MB per database (10 GB on the paid plan)

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}
