"use client";

import { useEffect, useRef, useState } from "react";
import { callApi } from "../../_ui/client";
import { Icon } from "../../_ui/icons";

const WAIT_SECONDS = 10;

/**
 * "Start practice": the practice shop is only made ready when it is asked for, which takes a few seconds (the pretend data is put
 * back to its starting point). A visible 10-second countdown makes the wait calm instead of puzzling, then the browser moves over.
 */
export function PracticeStart({ limit }: { limit: number }) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "failed">("idle");
  const [left, setLeft] = useState(WAIT_SECONDS);
  const [error, setError] = useState("");
  const ready = useRef(false);

  useEffect(() => {
    if (phase !== "waiting") return;
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const remaining = Math.max(0, WAIT_SECONDS - Math.floor((Date.now() - startedAt) / 1000));
      setLeft(remaining);
      if (remaining === 0 && ready.current) {
        window.clearInterval(tick);
        window.location.assign("/admin"); // a full page load, so the new practice cookie takes effect
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [phase]);

  async function start() {
    ready.current = false;
    setError("");
    setLeft(WAIT_SECONDS);
    setPhase("waiting");
    const result = await callApi("/api/admin/practice/start", "POST");
    if (result.ok) ready.current = true;
    else {
      setError(result.error);
      setPhase("failed");
    }
  }

  const done = WAIT_SECONDS - left;
  return (
    <section className="a-card">
      <div className="a-card-pad a-stack" style={{ gap: 16, maxWidth: 640 }}>
        {phase === "waiting" ? (
          <div role="status" aria-live="polite">
            <strong style={{ fontSize: 18 }}>Getting your practice shop ready…</strong>
            <p className="a-muted" style={{ margin: "6px 0 14px" }}>
              {left > 0 ? `About ${left} second${left === 1 ? "" : "s"} to go. ` : "Almost there. "}We are putting the pretend products and orders back to the way they start.
            </p>
            <div className="a-progress" aria-hidden="true">
              <span style={{ width: `${(done / WAIT_SECONDS) * 100}%` }} />
            </div>
          </div>
        ) : (
          <>
            <ul className="a-practice-list">
              <li>
                <Icon name="check" size={18} /> Pretend products, orders and settings: change, cancel or delete anything.
              </li>
              <li>
                <Icon name="check" size={18} /> No email, WhatsApp, TCS booking or notification is ever sent.
              </li>
              <li>
                <Icon name="check" size={18} /> {limit.toLocaleString("en-PK")} clicks a day and a small storage allowance (1 MB), so it stays tidy.
              </li>
              <li>
                <Icon name="check" size={18} /> “Start again” puts everything back. Your real shop is never touched.
              </li>
            </ul>
            {phase === "failed" && (
              <p className="a-error" role="alert">
                {error}
              </p>
            )}
            <div>
              <button type="button" className="a-btn a-btn-primary a-btn-lg" onClick={() => void start()}>
                <Icon name="sparkle" size={18} /> Start practice
              </button>
              <p className="a-help" style={{ marginTop: 8 }}>
                It takes about 10 seconds to get ready.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
