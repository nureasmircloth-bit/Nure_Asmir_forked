"use client";

import { reportError } from "@/lib/sentry-lazy";
import { useEffect } from "react";

export default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error);
    console.error("Storefront route error", error);
  }, [error]);

  return (
    <main style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <p className="eyebrow">Nure Asmir</p>
        <h1 style={{ margin: "8px 0 16px", font: "400 clamp(32px, 5vw, 46px)/1.05 var(--display)" }}>
          Something briefly went wrong.
        </h1>
        <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          This was likely a momentary hiccup — please try again. If it keeps happening, WhatsApp us and we&apos;ll sort it out.
        </p>
        <button
          onClick={() => reset()}
          className="button button-dark"
          style={{ marginTop: 24, display: "inline-flex" }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
