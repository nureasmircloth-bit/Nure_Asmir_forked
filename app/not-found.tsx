import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "120px 24px", background: "var(--paper, #ffffff)", color: "var(--ink, #111111)", textAlign: "center" }}>
      <div style={{ maxWidth: 540, width: "100%", margin: "0 auto" }}>
        <p style={{ margin: "0 0 12px", fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted, #666)" }}>
          404 · Page Not Found
        </p>
        <h1 style={{ margin: "0 0 16px", font: "500 clamp(36px, 5vw, 60px)/1.08 var(--display, serif)" }}>
          An elusive piece.
        </h1>
        <p style={{ margin: "0 auto 32px", fontSize: 15, lineHeight: 1.6, color: "var(--muted, #666)", maxWidth: 420 }}>
          The page you requested may have moved, expired, or does not exist. Our current collections and pieces are available in our shop.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
          <Link
            href="/shop"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 48,
              padding: "0 28px",
              background: "var(--ink, #111111)",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              borderRadius: "var(--radius-theme, 4px)",
              textDecoration: "none",
            }}
          >
            Explore collection
          </Link>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 48,
              padding: "0 28px",
              background: "transparent",
              color: "var(--ink, #111111)",
              border: "1px solid var(--line, rgba(0,0,0,0.15))",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              borderRadius: "var(--radius-theme, 4px)",
              textDecoration: "none",
            }}
          >
            Return home
          </Link>
        </div>
      </div>
    </main>
  );
}
