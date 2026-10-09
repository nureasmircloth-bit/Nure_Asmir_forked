import { isPracticeRequest } from "@/lib/practice-context";
import { AwsClient } from "aws4fetch";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { recordApiCall } from "@/lib/usage";
import { runInBackground } from "@/lib/background";

/**
 * Neon Object Storage (S3-compatible), declared in neon.ts. Two buckets:
 *   - public  ("nure-asmir-media",   public_read) — product / category / campaign imagery. Read
 *     anonymously by the Cloudflare CDN (see lib/media-url.ts and app/cdn/[...key]/route.ts).
 *   - private ("nure-asmir-private", private)     — customer payment proofs. Only ever read back
 *     through a short-lived presigned URL handed to a signed-in admin.
 * Credentials come from the AWS_* variables `neon env pull` / `neon deploy` write to .env.local.
 *
 * Requests are signed with aws4fetch (SigV4 over plain fetch, ~3 KB) rather than the AWS SDK, which
 * would add well over a megabyte to the Cloudflare Worker bundle.
 */
export type Visibility = "public" | "private";

/**
 * Two free object stores are used together (about 15 GB in all): Neon Storage and Cloudflare R2.
 * Public pictures go to whichever has more room left; every other file (payment proofs, refund photos) stays on Neon.
 * The backend is part of the key: R2 objects start with "r2/", so reading, serving and deleting always find the right store
 * with no extra database column. R2 is reached through a Worker binding (MEDIA_R2) – no keys to manage.
 */
export type Backend = "neon" | "r2";
export const R2_PREFIX = "r2/";
export const backendOf = (key: string): Backend => (key.startsWith(R2_PREFIX) ? "r2" : "neon");

/** The slice of Cloudflare's R2 bucket API this file uses. */
export type R2Like = {
  put(key: string, value: ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number; httpEtag?: string; httpMetadata?: { contentType?: string }; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string; size: number }>; truncated: boolean; cursor?: string }>;
};

/** The R2 bucket, or null when this process has none (local development, or R2 not switched on yet). */
export function r2Bucket(): R2Like | null {
  try {
    const env = getCloudflareContext().env as unknown as { MEDIA_R2?: R2Like };
    return env.MEDIA_R2 ?? null;
  } catch {
    return null;
  }
}

const count = (service: "neon-storage" | "r2-storage", ok: boolean, error = "") => runInBackground(recordApiCall(service, ok, error), `usage:${service}`);

/** Free allowance of each store, in bytes (the developer page shows used vs this). */
export const STORAGE_LIMITS: Record<Backend, number> = { neon: 5 * 1024 ** 3, r2: 10 * 1024 ** 3 };

const SMART_PREFIXES = ["products", "categories", "campaign", "site"];
let placement: Backend = "neon";
let placementAt = 0;
const PLACEMENT_MS = 5 * 60 * 1000;

/** Re-reads how full each store is (a cheap one-row-each read) at most every few minutes. Never throws. */
async function refreshPlacement(): Promise<void> {
  try {
    const { db } = await import("@/db");
    const { inArray } = await import("drizzle-orm");
    const { serviceStats } = await import("@/db/schema");
    const rows = await db.select().from(serviceStats).where(inArray(serviceStats.key, ["storage:neon", "storage:r2"]));
    const used = (key: string) => Number((rows.find((row) => row.key === key)?.value as { bytes?: number } | undefined)?.bytes ?? 0);
    const neon = used("storage:neon") / STORAGE_LIMITS.neon;
    const r2 = used("storage:r2") / STORAGE_LIMITS.r2;
    placement = r2 <= neon ? "r2" : "neon";
    if (neon >= 0.97 && r2 < 0.97) placement = "r2";
    if (r2 >= 0.97 && neon < 0.97) placement = "neon";
  } catch {
    // keep the last choice
  }
}

/** Which store the next public picture should go to. */
export function chooseBackend(prefix: string): Backend {
  if (!SMART_PREFIXES.some((allowed) => prefix === allowed || prefix.startsWith(`${allowed}/`))) return "neon";
  if (!r2Bucket()) return "neon";
  if (Date.now() - placementAt > PLACEMENT_MS) {
    if (placementAt === 0) placement = "r2"; // before the first reading both stores look empty: start with the bigger one
    placementAt = Date.now();
    runInBackground(refreshPlacement(), "storage-placement");
  }
  return placement;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — run \`neon env pull\` or check .env.local`);
  return value;
}

let client: AwsClient | null = null;

function aws(): AwsClient {
  if (client) return client;
  client = new AwsClient({
    accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
    region: process.env.AWS_REGION || "ap-southeast-1",
    service: "s3",
  });
  return client;
}

export function bucketName(visibility: Visibility): string {
  return visibility === "public"
    ? process.env.STORAGE_PUBLIC_BUCKET || "nure-asmir-media"
    : process.env.STORAGE_PRIVATE_BUCKET || "nure-asmir-private";
}

function endpoint(): string {
  return requireEnv("AWS_ENDPOINT_URL_S3").replace(/\/$/, "");
}

/** Path-style object URL (Neon requires path-style addressing). */
function objectUrl(key: string, visibility: Visibility): string {
  return `${endpoint()}/${bucketName(visibility)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Public origin of the media bucket, e.g. https://br-xxx.storage.c-4.ap-southeast-1.aws.neon.tech/nure-asmir-media */
export function publicBucketOrigin(): string {
  return `${endpoint()}/${bucketName("public")}`;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

export function newObjectKey(prefix: string, contentType: string, backend: Backend = chooseBackend(prefix)): string {
  // Map known types explicitly – never derive the extension from user-controlled header text.
  const ext = EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ?? "bin";
  return `${backend === "r2" ? R2_PREFIX : ""}${prefix}/${crypto.randomUUID()}.${ext}`;
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
  visibility: Visibility = "public",
): Promise<void> {
  if (backendOf(key) === "r2") {
    const bucket = r2Bucket();
    if (!bucket) throw new Error("R2 is not available here");
    try {
      await bucket.put(key, body, { httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" } });
      count("r2-storage", true);
    } catch (error) {
      count("r2-storage", false, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return;
  }
  const response = await aws().fetch(objectUrl(key, visibility), {
    method: "PUT",
    body: body as unknown as BodyInit,
    headers: {
      "Content-Type": contentType,
      // Keys are random UUIDs and never overwritten in place, so the CDN may cache them forever.
      ...(visibility === "public" ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
    },
  });
  count("neon-storage", response.ok, response.ok ? "" : `PUT ${response.status}`);
  if (!response.ok) throw new Error(`Storage PUT ${key} failed: ${response.status} ${await response.text().catch(() => "")}`);
}

export async function getObjectBytes(
  key: string,
  visibility: Visibility = "public",
): Promise<{ body: Uint8Array; contentType?: string } | null> {
  if (backendOf(key) === "r2") {
    try {
      const object = await r2Bucket()?.get(key);
      count("r2-storage", true);
      return object ? { body: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType } : null;
    } catch {
      count("r2-storage", false, "get failed");
      return null;
    }
  }
  try {
    const response = await aws().fetch(objectUrl(key, visibility));
    count("neon-storage", response.ok || response.status === 404, response.ok ? "" : `GET ${response.status}`);
    if (!response.ok) return null;
    return { body: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? undefined };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string, visibility: Visibility = "public"): Promise<void> {
  // The practice shop shares the picture store with the real shop: practising must never delete a real picture.
  if (isPracticeRequest()) return;
  if (backendOf(key) === "r2") {
    await r2Bucket()?.delete(key);
    count("r2-storage", true);
    return;
  }
  const response = await aws().fetch(objectUrl(key, visibility), { method: "DELETE" });
  count("neon-storage", response.ok || response.status === 404, response.ok ? "" : `DELETE ${response.status}`);
  // S3 answers 204 whether or not the key existed; anything else is a real failure.
  if (!response.ok && response.status !== 404) throw new Error(`Storage DELETE ${key} failed: ${response.status}`);
}

/** Short-lived signed URL for admin-only access to private objects (payment proofs). */
export async function getSignedObjectUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const url = new URL(objectUrl(key, "private"));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await aws().sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/** Adds up what is stored in one backend (all of its buckets). Reads the object listing – a few requests per thousand files; never called per visitor. */
export async function measureStore(backend: Backend): Promise<{ bytes: number; objects: number }> {
  let bytes = 0;
  let objects = 0;
  if (backend === "r2") {
    const bucket = r2Bucket();
    if (!bucket) throw new Error("R2 is not available here");
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const listing = await bucket.list({ cursor, limit: 1000 });
      count("r2-storage", true);
      for (const object of listing.objects) {
        bytes += object.size;
        objects += 1;
      }
      if (!listing.truncated) break;
      cursor = listing.cursor;
    }
    return { bytes, objects };
  }
  for (const visibility of ["public", "private"] as const) {
    let token = "";
    for (let page = 0; page < 200; page++) {
      const url = new URL(`${endpoint()}/${bucketName(visibility)}`);
      url.searchParams.set("list-type", "2");
      if (token) url.searchParams.set("continuation-token", token);
      const response = await aws().fetch(url.toString());
      count("neon-storage", response.ok, response.ok ? "" : `LIST ${response.status}`);
      if (!response.ok) {
        if (response.status === 404) break;
        throw new Error(`Storage LIST failed: ${response.status}`);
      }
      const xml = await response.text();
      for (const match of xml.matchAll(/<Size>(\d+)<\/Size>/g)) {
        bytes += Number(match[1]);
        objects += 1;
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : "";
      if (!token) break;
    }
  }
  return { bytes, objects };
}
