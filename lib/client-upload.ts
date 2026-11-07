"use client";

// Browser-side helpers for sending pictures to the admin API. Every picture is shrunk and converted to
// WebP in the owner's browser first (see client-image-processing.ts) so the server never receives a
// 10 MB phone photo — and so the website gets small, fast pictures automatically.

import { processImageClientSide } from "./client-image-processing";

export type UploadOutcome = { ok: true; image: { id: string; r2Key: string; variantWidths: number[] | null; isPrimary: boolean } } | { ok: false; error: string };

export const MAX_PICTURE_MB = 25;
/** The five picture types the shop owner can upload. Each is turned into five WebP sizes in the browser before it is sent. */
export const ACCEPTED_PICTURES = "image/jpeg,image/png,image/webp,image/avif,image/gif";
const ACCEPTED_LIST = ACCEPTED_PICTURES.split(",");

export function checkPictureFile(file: File): string | null {
  if (/.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) return `“${file.name}” is an iPhone HEIC picture. On the iPhone choose Settings → Camera → Formats → Most Compatible, or share the photo as JPG, then add it again.`;
  if (!ACCEPTED_LIST.includes(file.type)) return `“${file.name}” is not a JPG, PNG, WebP, AVIF or GIF picture.`;
  if (file.size > MAX_PICTURE_MB * 1024 * 1024) return `“${file.name}” is bigger than ${MAX_PICTURE_MB} MB.`;
  return null;
}

/** Shrinks a picture and uploads it to a product. */
export async function uploadProductPicture(options: { productId: string; file: File | Blob; altText: string; isPrimary?: boolean; sortOrder?: number; variantId?: string; pendingPictureId?: string }): Promise<UploadOutcome> {
  const source = options.file instanceof File ? options.file : new File([options.file], "picture.webp", { type: options.file.type || "image/webp" });
  const processed = await processImageClientSide(source);
  if (!processed) return { ok: false, error: "That picture could not be prepared. Try another picture (JPG, PNG or WebP)." };

  const form = new FormData();
  form.set("productId", options.productId);
  form.set("altText", options.altText);
  form.set("isPrimary", options.isPrimary ? "true" : "false");
  form.set("sortOrder", String(options.sortOrder ?? 0));
  if (options.variantId) form.set("variantId", options.variantId);
  // A picture that answers a waiting-list entry (“Pictures for new products”) is crossed off by the server in the same request, so a picture can never be saved but still listed as missing.
  if (options.pendingPictureId) form.set("pendingPictureId", options.pendingPictureId);
  form.set("width", String(processed.width));
  form.set("height", String(processed.height));
  form.set("blurDataUrl", processed.blurDataUrl);
  form.set("variantWidths", JSON.stringify(processed.variants.map((variant) => variant.width)));
  for (const variant of processed.variants) form.set(`variant_${variant.width}`, variant.blob, `variant-${variant.width}.webp`);
  // The biggest generated size doubles as the stored original: full quality, but never a huge phone photo.
  const largest = processed.variants[processed.variants.length - 1];
  form.set("file", largest.blob, `product-${largest.width}.webp`);

  try {
    const response = await fetch("/api/admin/images", { method: "POST", body: form });
    const data = (await response.json().catch(() => ({}))) as { image?: { id: string; r2Key: string; variantWidths: number[] | null; isPrimary: boolean }; error?: string };
    if (!response.ok || !data.image) return { ok: false, error: data.error ?? "The picture could not be saved." };
    return { ok: true, image: data.image };
  } catch {
    return { ok: false, error: "Could not reach the server. Please check your internet." };
  }
}
