"use client";

import { reportError } from "@/lib/sentry-lazy";
import { useEffect } from "react";

// Catches errors thrown by the root layout itself (e.g. a slow/failed settings fetch) — rarer than
// a route-level error (see app/error.tsx) but without this, that specific failure mode falls
// straight through to Cloudflare's raw "Worker threw exception" page instead of anything on-brand.
// Next requires this file to render its own full <html>/<body>, since it replaces the root layout.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error);
    console.error("Root layout error", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Georgia, serif", background: "#1e1b18", color: "#f7f2ea" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <p style={{ letterSpacing: "0.16em", textTransform: "uppercase", fontSize: 11, color: "#a99682" }}>Nure Asmir</p>
            <h1 style={{ margin: "8px 0 16px", fontWeight: 400, fontSize: "clamp(32px, 5vw, 46px)", lineHeight: 1.05 }}>
              Something briefly went wrong.
            </h1>
            <p style={{ color: "#a99682", lineHeight: 1.6 }}>
              This was likely a momentary hiccup — please try again in a moment.
            </p>
            <button
              onClick={() => reset()}
              style={{
                marginTop: 24,
                padding: "14px 28px",
                background: "#f7f2ea",
                color: "#1e1b18",
                border: 0,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 14,
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
