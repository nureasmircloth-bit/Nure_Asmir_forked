"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { cropImageClientSide, processImageClientSide } from "@/lib/client-image-processing";
import { ImageCropper } from "./image-cropper";

// The crop frame is EXACTLY the frame the shop shows (see .banner-track in storefront.css), so what is cropped here is what customers see.
const DESKTOP_ASPECT = 2048 / 768; // wide strip on computers and tablets
const DESKTOP_LABEL = "wide, 8:3";
const MOBILE_ASPECT = 4 / 5; // phones
const MOBILE_LABEL = "tall, 4:5";

type PixelCrop = { x: number; y: number; width: number; height: number };

type ImageSlot = {
  file: File | null;
  crop: PixelCrop | null;
  previewUrl: string | null;
};

const EMPTY_SLOT: ImageSlot = { file: null, crop: null, previewUrl: null };

async function makePreview(file: File, crop: PixelCrop): Promise<string> {
  const bitmap = await cropImageClientSide(file, crop);
  const previewWidth = 320;
  const previewHeight = Math.max(1, Math.round((bitmap.height / bitmap.width) * previewWidth));
  const canvas = document.createElement("canvas");
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.7);
}

type Slide = {
  id: string;
  imageUrl: string;
  altText: string;
  eyebrow: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  sortOrder: number;
  active: boolean;
};

export function CampaignManager() {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [desktopSlot, setDesktopSlot] = useState<ImageSlot>(EMPTY_SLOT);
  const [mobileSlot, setMobileSlot] = useState<ImageSlot>(EMPTY_SLOT);
  const [cropTarget, setCropTarget] = useState<"desktop" | "mobile" | null>(null);

  // Replacing an existing slide's photo — separate slot/crop state from the "new slide" form
  // above so the two flows never clash, and so only one slide's inline uploader is open at once.
  const [editingSlideId, setEditingSlideId] = useState<string | null>(null);
  const [editDesktopSlot, setEditDesktopSlot] = useState<ImageSlot>(EMPTY_SLOT);
  const [editMobileSlot, setEditMobileSlot] = useState<ImageSlot>(EMPTY_SLOT);
  const [editCropTarget, setEditCropTarget] = useState<"desktop" | "mobile" | null>(null);
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const [editAltText, setEditAltText] = useState("");
  const [textBusyId, setTextBusyId] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/admin/campaign", { cache: "no-store" });
    if (response.ok) setSlides((await response.json()).slides);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function pickFile(target: "desktop" | "mobile", file: File | null) {
    if (!file) return;
    (target === "desktop" ? setDesktopSlot : setMobileSlot)({ file, crop: null, previewUrl: null });
    setCropTarget(target);
  }

  async function confirmCrop(crop: PixelCrop) {
    const target = cropTarget;
    setCropTarget(null);
    if (!target) return;
    const setSlot = target === "desktop" ? setDesktopSlot : setMobileSlot;
    setSlot((slot) => (slot.file ? { ...slot, crop } : slot));
    const file = target === "desktop" ? desktopSlot.file : mobileSlot.file;
    if (!file) return;
    try {
      const previewUrl = await makePreview(file, crop);
      setSlot((slot) => ({ ...slot, previewUrl }));
    } catch {
      // Preview is a nicety only — the stored crop rect is what actually matters at upload time.
    }
  }

  async function processSlot(slot: ImageSlot, prefix: string, form: FormData) {
    if (!slot.file || !slot.crop) return;
    const bitmap = await cropImageClientSide(slot.file, slot.crop);
    const processed = await processImageClientSide(bitmap);
    if (!processed) return;
    const largest = processed.variants[processed.variants.length - 1];
    form.set(prefix ? `${prefix}File` : "file", largest.blob, `campaign-${prefix || "desktop"}.webp`);
    form.set(`${prefix}blurDataUrl`, processed.blurDataUrl);
    form.set(`${prefix}variantWidths`, JSON.stringify(processed.variants.map((v) => v.width)));
    for (const variant of processed.variants) {
      form.set(`${prefix}variant_${variant.width}`, variant.blob, `${prefix}variant-${variant.width}.webp`);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!desktopSlot.file || !desktopSlot.crop) {
      setMessage("Choose and crop a desktop image first.");
      return;
    }
    setBusy(true);
    setMessage("Processing image…");
    const currentForm = event.currentTarget;
    try {
      const form = new FormData(currentForm);

      await processSlot(desktopSlot, "", form);
      if (mobileSlot.file && mobileSlot.crop) await processSlot(mobileSlot, "mobile", form);

      setMessage("Uploading…");
      const response = await fetch("/api/admin/campaign", { method: "POST", body: form });
      const result = await response.json();
      setMessage(response.ok ? "Campaign slide added." : result.error ?? "Slide could not be added.");
      if (response.ok) {
        currentForm.reset();
        setDesktopSlot(EMPTY_SLOT);
        setMobileSlot(EMPTY_SLOT);
        await refresh();
      }
    } catch (error) {
      // Without this, any hiccup after the upload succeeded (a transient network blip during the
      // refresh(), for instance) left `busy` stuck true forever — the button would show the
      // spinner and "Campaign slide added." indefinitely even though the slide was already saved.
      console.error("campaign upload failed", error);
      setMessage("Something went wrong after the upload — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSlide(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setTextBusyId(id);
    try {
      const form = new FormData(event.currentTarget);
      const body = {
        eyebrow: form.get("eyebrow"),
        headline: form.get("headline"),
        body: form.get("body"),
        ctaLabel: form.get("ctaLabel"),
        ctaHref: form.get("ctaHref"),
        sortOrder: form.get("sortOrder"),
        active: form.get("active") === "on",
      };
      const response = await fetch(`/api/admin/campaign/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      setMessage(response.ok ? "Slide updated." : (result.error ?? "Slide could not be updated."));
      if (response.ok) await refresh();
    } catch (error) {
      console.error("saveSlide failed", error);
      setMessage("Something went wrong saving the slide — check your connection and try again.");
    } finally {
      setTextBusyId(null);
    }
  }

  function startImageEdit(slide: Slide) {
    setEditingSlideId(slide.id);
    setEditDesktopSlot(EMPTY_SLOT);
    setEditMobileSlot(EMPTY_SLOT);
    setEditAltText(slide.altText);
  }

  function cancelImageEdit() {
    setEditingSlideId(null);
    setEditDesktopSlot(EMPTY_SLOT);
    setEditMobileSlot(EMPTY_SLOT);
  }

  function pickEditFile(target: "desktop" | "mobile", file: File | null) {
    if (!file) return;
    (target === "desktop" ? setEditDesktopSlot : setEditMobileSlot)({ file, crop: null, previewUrl: null });
    setEditCropTarget(target);
  }

  async function confirmEditCrop(crop: PixelCrop) {
    const target = editCropTarget;
    setEditCropTarget(null);
    if (!target) return;
    const setSlot = target === "desktop" ? setEditDesktopSlot : setEditMobileSlot;
    setSlot((slot) => (slot.file ? { ...slot, crop } : slot));
    const file = target === "desktop" ? editDesktopSlot.file : editMobileSlot.file;
    if (!file) return;
    try {
      const previewUrl = await makePreview(file, crop);
      setSlot((slot) => ({ ...slot, previewUrl }));
    } catch {
      // Preview is a nicety only — the stored crop rect is what actually matters at upload time.
    }
  }

  async function saveSlideImage(slideId: string) {
    if (!editDesktopSlot.file || !editDesktopSlot.crop) {
      setMessage("Choose and crop a new desktop image first.");
      return;
    }
    setImageBusyId(slideId);
    setMessage("Processing image…");
    try {
      const form = new FormData();
      if (editAltText.trim()) form.set("altText", editAltText.trim());
      await processSlot(editDesktopSlot, "", form);
      if (editMobileSlot.file && editMobileSlot.crop) await processSlot(editMobileSlot, "mobile", form);

      setMessage("Uploading…");
      const response = await fetch(`/api/admin/campaign/${slideId}/image`, { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      setMessage(response.ok ? "Slide photo updated." : (result.error ?? "Photo could not be updated."));
      if (response.ok) {
        cancelImageEdit();
        await refresh();
      }
    } catch (error) {
      console.error("saveSlideImage failed", error);
      setMessage("Something went wrong updating the photo — check your connection and try again.");
    } finally {
      setImageBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this campaign slide?")) return;
    const response = await fetch(`/api/admin/campaign/${id}`, { method: "DELETE" });
    setMessage(response.ok ? "Campaign slide removed." : "Slide could not be removed.");
    if (response.ok) await refresh();
  }

  return (
    <section className="admin-main">
      <header className="admin-topbar">
        <div>
          <h1>Home page banners</h1>
          <p className="a-muted" style={{ marginTop: 5, maxWidth: 680 }}>The big pictures at the top of your home page. They change one after another. Upload a wide picture for computers and, if you like, a tall one for phones.</p>
        </div>
      </header>
      {message && (
        <div className="admin-message" role="status">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
      <div className="campaign-admin-grid">
        <section className="campaign-list">
          <p className="eyebrow">Current sequence</p>
          {slides.length ? (
            slides.map((slide, index) => (
              <article key={slide.id}>
                <div>
                  <Image src={slide.imageUrl} alt={slide.altText} fill sizes="220px" />
                </div>
                <span>0{index + 1}</span>
                <section>
                  <form onSubmit={(event) => saveSlide(event, slide.id)} className="admin-form-grid">
                    <label>
                      <span>Small heading</span>
                      <input name="eyebrow" defaultValue={slide.eyebrow} />
                    </label>
                    <label>
                      <span>Main headline</span>
                      <input name="headline" defaultValue={slide.headline} />
                    </label>
                    <label className="field-wide">
                      <span>Supporting text</span>
                      <textarea name="body" rows={2} defaultValue={slide.body} />
                    </label>
                    <label>
                      <span>Button label</span>
                      <input name="ctaLabel" defaultValue={slide.ctaLabel} />
                    </label>
                    <label>
                      <span>Button link</span>
                      <input name="ctaHref" defaultValue={slide.ctaHref} />
                    </label>
                    <label>
                      <span>Sequence</span>
                      <input type="number" min="0" name="sortOrder" defaultValue={slide.sortOrder} />
                    </label>
                    <label className="admin-check">
                      <input type="checkbox" name="active" defaultChecked={slide.active} />
                      <span>Active</span>
                    </label>
                    <button className="admin-primary" disabled={textBusyId === slide.id}>
                      {textBusyId === slide.id ? "Saving…" : "Save slide"}
                    </button>
                  </form>
                  <div className="campaign-slide-actions">
                    {editingSlideId === slide.id ? (
                      <button type="button" onClick={cancelImageEdit}>
                        Cancel photo change
                      </button>
                    ) : (
                      <button type="button" onClick={() => startImageEdit(slide)}>
                        Replace photo
                      </button>
                    )}
                    <button onClick={() => remove(slide.id)}>Remove slide</button>
                  </div>

                  {editingSlideId === slide.id && (
                    <div className="campaign-image-slots campaign-image-slots-inline">
                      <div className="campaign-image-slot">
                        <span>New desktop image ({DESKTOP_LABEL}, required)</span>
                        {editDesktopSlot.previewUrl ? (
                          <div className="campaign-slot-preview">
                            <Image src={editDesktopSlot.previewUrl} alt="" fill unoptimized sizes="220px" />
                          </div>
                        ) : (
                          <div className="campaign-slot-empty">No crop set yet</div>
                        )}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                          onChange={(event) => pickEditFile("desktop", event.target.files?.[0] ?? null)}
                        />
                        {editDesktopSlot.file && !editDesktopSlot.crop && (
                          <small>Choose &ldquo;Use this crop&rdquo; in the popup to confirm framing.</small>
                        )}
                      </div>
                      <div className="campaign-image-slot">
                        <span>New mobile image ({MOBILE_LABEL}, optional)</span>
                        {editMobileSlot.previewUrl ? (
                          <div className="campaign-slot-preview campaign-slot-preview-tall">
                            <Image src={editMobileSlot.previewUrl} alt="" fill unoptimized sizes="140px" />
                          </div>
                        ) : (
                          <div className="campaign-slot-empty campaign-slot-empty-tall">No crop set yet</div>
                        )}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                          onChange={(event) => pickEditFile("mobile", event.target.files?.[0] ?? null)}
                        />
                      </div>
                      <label className="field-wide">
                        <span>Accessible image description</span>
                        <input value={editAltText} onChange={(event) => setEditAltText(event.target.value)} />
                      </label>
                      <button
                        type="button"
                        className="admin-primary"
                        disabled={imageBusyId === slide.id}
                        onClick={() => saveSlideImage(slide.id)}
                      >
                        {imageBusyId === slide.id ? (
                          <span className="busy-label">
                            <span className="spinner spinner-light" aria-hidden="true" /> {message || "Uploading…"}
                          </span>
                        ) : (
                          "Save new photo"
                        )}
                      </button>
                    </div>
                  )}
                </section>
              </article>
            ))
          ) : (
            <div className="admin-empty">
              <h3>The original campaign is active.</h3>
              <p>Add an image to begin the rotating sequence.</p>
            </div>
          )}
        </section>
        <form className="campaign-upload" onSubmit={upload}>
          <p className="eyebrow">New slide</p>
          <h2>Add campaign image</h2>
          <div className="campaign-image-slots">
            <div className="campaign-image-slot">
              <span>Desktop image ({DESKTOP_LABEL}, required)</span>
              {desktopSlot.previewUrl ? (
                <div className="campaign-slot-preview">
                  <Image src={desktopSlot.previewUrl} alt="" fill unoptimized sizes="220px" />
                </div>
              ) : (
                <div className="campaign-slot-empty">No crop set yet</div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                onChange={(event) => pickFile("desktop", event.target.files?.[0] ?? null)}
              />
              {desktopSlot.file && !desktopSlot.crop && (
                <small>Choose &ldquo;Use this crop&rdquo; in the popup to confirm framing.</small>
              )}
            </div>
            <div className="campaign-image-slot">
              <span>Mobile image ({MOBILE_LABEL}, optional — if skipped, phones show the middle of the computer picture)</span>
              {mobileSlot.previewUrl ? (
                <div className="campaign-slot-preview campaign-slot-preview-tall">
                  <Image src={mobileSlot.previewUrl} alt="" fill unoptimized sizes="140px" />
                </div>
              ) : (
                <div className="campaign-slot-empty campaign-slot-empty-tall">No crop set yet</div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                onChange={(event) => pickFile("mobile", event.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <label>
            <span>Accessible image description</span>
            <input required name="altText" />
          </label>
          <label>
            <span>Small heading</span>
            <input name="eyebrow" defaultValue="The first edit · 2026" />
          </label>
          <label>
            <span>Main headline</span>
            <input name="headline" defaultValue="The final layer, considered." />
          </label>
          <label>
            <span>Supporting text</span>
            <textarea name="body" rows={3} defaultValue="Shalwar kameez, shirts, pants and accessories for the modern man." />
          </label>
          <div>
            <label>
              <span>Button label</span>
              <input name="ctaLabel" defaultValue="Shop the first edit" />
            </label>
            <label>
              <span>Button link</span>
              <input name="ctaHref" defaultValue="/shop" />
            </label>
          </div>
          <label>
            <span>Sequence number</span>
            <input type="number" min="0" name="sortOrder" defaultValue={slides.length} />
          </label>
          <button className="admin-primary" disabled={busy}>
            {busy ? (
              <span className="busy-label">
                <span className="spinner spinner-light" aria-hidden="true" /> {message || "Uploading…"}
              </span>
            ) : (
              "Add to homepage rotation"
            )}
          </button>
        </form>
      </div>
      {cropTarget && (cropTarget === "desktop" ? desktopSlot.file : mobileSlot.file) && (
        <ImageCropper
          file={(cropTarget === "desktop" ? desktopSlot.file : mobileSlot.file) as File}
          aspect={cropTarget === "desktop" ? DESKTOP_ASPECT : MOBILE_ASPECT}
          label={cropTarget === "desktop" ? `Crop the computer picture (${DESKTOP_LABEL})` : `Crop the phone picture (${MOBILE_LABEL})`}
          onConfirm={confirmCrop}
          onCancel={() => setCropTarget(null)}
        />
      )}
      {editCropTarget && (editCropTarget === "desktop" ? editDesktopSlot.file : editMobileSlot.file) && (
        <ImageCropper
          file={(editCropTarget === "desktop" ? editDesktopSlot.file : editMobileSlot.file) as File}
          aspect={editCropTarget === "desktop" ? DESKTOP_ASPECT : MOBILE_ASPECT}
          label={editCropTarget === "desktop" ? `Crop the computer picture (${DESKTOP_LABEL})` : `Crop the phone picture (${MOBILE_LABEL})`}
          onConfirm={confirmEditCrop}
          onCancel={() => setEditCropTarget(null)}
        />
      )}
    </section>
  );
}
