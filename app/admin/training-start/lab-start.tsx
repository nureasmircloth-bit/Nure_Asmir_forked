"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { callApi } from "../_ui/client";

const WAIT_SECONDS = 10;
const STAGES = ["Setting up pretend products", "Filling in pretend orders", "Switching off every real message", "Opening your lab"];

/**
 * "Start my lab": the lab is only made ready when it is asked for. The pretend data is put back to its starting point while a visible
 * 10-second countdown plays, so the wait feels like something starting up (not like a page that is stuck), then the lab opens.
 */
export function LabStart({ name, returnTo, clicksLeft, limit }: { name: string; returnTo: string; clicksLeft: number; limit: number }) {
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
        window.location.assign(returnTo); // a full page load, so the lab opens fresh
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [phase, returnTo]);

  async function start() {
    ready.current = false;
    setError("");
    setLeft(WAIT_SECONDS);
    setPhase("waiting");
    const result = await callApi("/api/admin/sandbox/start", "POST");
    if (result.ok) ready.current = true;
    else {
      setError(result.error);
      setPhase("failed");
    }
  }

  const done = WAIT_SECONDS - left;
  const stage = Math.min(STAGES.length - 1, Math.floor((done / WAIT_SECONDS) * STAGES.length));
  return (
    <main className="adm-login-wrap lab-entrance">
      <div className="a-card adm-login lab-entrance-card">
        <div className="lab-entrance-badge">
          <Image src="/logo-icon.png" alt="Nure Asmir" width={56} height={56} priority />
          <span>TRAINING LAB</span>
        </div>
        {phase === "waiting" ? (
          <div role="status" aria-live="polite" className="lab-boot">
            <h1>Starting your lab…</h1>
            <p className="a-muted lab-boot-stage" key={stage}>
              {STAGES[stage]}
              {left > 0 ? ` · about ${left} second${left === 1 ? "" : "s"} to go` : " · almost there"}
            </p>
            <div className="a-progress" aria-hidden="true">
              <span style={{ width: `${(done / WAIT_SECONDS) * 100}%` }} />
            </div>
          </div>
        ) : (
          <>
            <div>
              <h1>Welcome, {name}</h1>
              <p className="a-muted" style={{ marginTop: 6 }}>
                Press the button to start your lab. It takes about 10 seconds to get ready.
              </p>
            </div>
            <ul className="lab-entrance-points">
              <li>Pretend products, orders and settings: change, cancel or delete anything.</li>
              <li>No email, WhatsApp, TCS booking or notification is ever sent.</li>
              <li>
                {limit.toLocaleString("en-PK")} clicks a day for the whole lab ({clicksLeft.toLocaleString("en-PK")} left today) and a small storage allowance.
              </li>
              <li>The lab is shared: pressing “Start again” puts everything back for everyone using it.</li>
            </ul>
            {phase === "failed" && (
              <p className="a-error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="a-btn a-btn-primary a-btn-lg" onClick={() => void start()}>
              Start my lab
            </button>
          </>
        )}
      </div>
    </main>
  );
}
