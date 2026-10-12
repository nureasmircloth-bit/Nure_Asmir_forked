"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cropImageClientSide, processImageClientSide } from "@/lib/client-image-processing";
import { ACCEPTED_PICTURES, checkPictureFile } from "@/lib/client-upload";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { ImageCropper } from "../campaign/image-cropper";

export function SiteImageSlot({ slot, label, help, size, aspect, fallback, current }: { slot: string; label: string; help: string; size: string; aspect: string; fallback: string; current: { url: string; version: number } | null }) {
  const router = useRouter();
  const toast = useToast();
  const upload = useLockedAction();
  const reset = useLockedAction();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [ratio] = useState(() => {
    const [a, b] = aspect.split("/").map((part) => Number(part.trim()));
    return a / b;
  });

  async function send(crop: { x: number; y: number; width: number; height: number }) {
    const file = picked;
    setPicked(null);
    if (!file) return;
    await upload.run(async () => {
      const bitmap = await cropImageClientSide(file, crop);
      const processed = await processImageClientSide(bitmap);
      if (!processed) return void toast("That picture could not be prepared. Please try another one.", "bad");
      const form = new FormData();
      form.set("slot", slot);
      form.set("altText", label.replace(/[“”]/g, ""));
      form.set("width", String(processed.width));
      form.set("height", String(processed.height));
      form.set("blurDataUrl", processed.blurDataUrl);
      form.set("variantWidths", JSON.stringify(processed.variants.map((variant) => variant.width)));
      for (const variant of processed.variants) form.set(`variant_${variant.width}`, variant.blob, `variant-${variant.width}.webp`);
      const largest = processed.variants[processed.variants.length - 1];
      form.set("file", largest.blob, `site-${largest.width}.webp`);
      const response = await fetch("/api/admin/site-images", { method: "POST", body: form }).catch(() => null);
      const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      if (response?.ok) {
        toast("Picture changed. It is live on your website.", "good");
        router.refresh();
      } else toast(data?.error ?? "Could not save the picture. Please check your internet.", "bad");
    });
  }

  const isMobileSlot = slot.includes("mobile") || aspect.includes("9 / 16") || aspect.includes("9/16");
  const [previewMode, setPreviewMode] = useState<"box" | "phone">(isMobileSlot ? "phone" : "box");

  const shown = current ? current.url : fallback;
  return (
    <section className="a-card">
      <header className="a-card-head" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 16 }}>{label}</h2>
        {isMobileSlot && <span style={{ fontSize: 11, background: "rgba(197, 160, 89, 0.15)", color: "#8a6d2f", padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>Mobile 9:16</span>}
      </header>
      <div className="a-card-pad a-stack" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ink-light)", fontWeight: 500 }}>
            {previewMode === "phone" ? "Mobile phone mockup" : "Standard canvas"}
          </span>
          <div style={{ display: "inline-flex", background: "var(--sunk)", borderRadius: 6, padding: 2, border: "1px solid var(--line)" }}>
            <button
              type="button"
              onClick={() => setPreviewMode("box")}
              style={{
                border: 0,
                background: previewMode === "box" ? "var(--bg)" : "transparent",
                color: previewMode === "box" ? "var(--ink)" : "var(--ink-light)",
                fontWeight: previewMode === "box" ? 600 : 400,
                borderRadius: 4,
                padding: "3px 8px",
                fontSize: 11,
                cursor: "pointer",
                boxShadow: previewMode === "box" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              }}
            >
              Canvas
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("phone")}
              style={{
                border: 0,
                background: previewMode === "phone" ? "var(--bg)" : "transparent",
                color: previewMode === "phone" ? "var(--ink)" : "var(--ink-light)",
                fontWeight: previewMode === "phone" ? 600 : 400,
                borderRadius: 4,
                padding: "3px 8px",
                fontSize: 11,
                cursor: "pointer",
                boxShadow: previewMode === "phone" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              }}
            >
              📱 Phone Frame
            </button>
          </div>
        </div>

        {previewMode === "phone" ? (
          <div
            style={{
              width: "200px",
              height: "356px",
              margin: "0 auto",
              borderRadius: "32px",
              border: "7px solid #1f2937",
              background: "#09090b",
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 14px 28px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.08) inset",
            }}
          >
            {/* Notch */}
            <div
              style={{
                position: "absolute",
                top: 6,
                left: "50%",
                transform: "translateX(-50%)",
                width: 60,
                height: 12,
                borderRadius: 8,
                background: "#09090b",
                zIndex: 5,
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            {/* Mobile screen hint overlay */}
            <div
              style={{
                position: "absolute",
                bottom: 8,
                left: 8,
                right: 8,
                background: "rgba(0,0,0,0.68)",
                backdropFilter: "blur(4px)",
                color: "#fff",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 10,
                textAlign: "center",
                pointerEvents: "none",
                letterSpacing: "0.02em",
              }}
            >
              📱 Mobile Screen View
            </div>
          </div>
        ) : (
          <div style={{ aspectRatio: aspect, maxHeight: 260, position: "relative", overflow: "hidden", borderRadius: 10, background: "var(--sunk)", border: "1px solid var(--line)", margin: "0 auto", width: "min(100%, 420px)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}
        <p className="a-muted">{help}</p>
        <p className="a-help">Best size: {size}. {current ? "You are using your own picture." : "Right now the standard picture is used."}</p>
        <div className="a-row">
          <button type="button" className="a-btn a-btn-primary" onClick={() => input.current?.click()} disabled={upload.pending}>
            {upload.pending ? <span className="busy-label"><span className="spinner spinner-light" aria-hidden="true" /> Saving…</span> : <><Icon name="upload" /> Choose a new picture</>}
          </button>
          {current && (
            <button
              type="button"
              className="a-btn a-btn-quiet"
              disabled={reset.pending}
              onClick={() =>
                reset.run(async () => {
                  const result = await callApi(`/api/admin/site-images?slot=${slot}`, "DELETE");
                  if (result.ok) {
                    toast("Back to the standard picture.", "good");
                    router.refresh();
                  } else toast(result.error, "bad");
                })
              }
            >
              Use the standard picture again
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_PICTURES}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const problem = checkPictureFile(file);
            if (problem) toast(problem, "bad");
            else setPicked(file);
          }}
        />
      </div>
      {picked && <ImageCropper file={picked} aspect={ratio} label={`Choose the part of the picture to show — ${label}`} onConfirm={send} onCancel={() => setPicked(null)} />}
    </section>
  );
}
