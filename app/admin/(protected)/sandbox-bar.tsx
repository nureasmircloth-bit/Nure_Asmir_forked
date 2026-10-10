"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, Dialog, useToast } from "../_ui/client";

/** The indigo strip across the top of the training lab: it can never be mistaken for the real admin, and says how much of today's allowance is left. */
export function SandboxBar({ left, limit, adminUrl }: { left: number; limit: number; adminUrl: string }) {
  const router = useRouter();
  const toast = useToast();
  const action = useLockedAction();
  const [asking, setAsking] = useState(false);

  async function reset() {
    setAsking(false);
    await action.run(async () => {
      const result = await callApi("/api/admin/sandbox/start", "POST");
      if (result.ok) {
        // the lab guide forgets what it had ticked, because the pretend shop is back at its start
        try {
          for (const key of Object.keys(window.localStorage)) if (key.startsWith("na-lab-done:")) window.localStorage.removeItem(key);
        } catch {
          // storage blocked: the guide simply re-checks
        }
        window.dispatchEvent(new Event("na-lab-reset"));
        toast("The lab is back to its starting data.", "good");
        router.refresh();
      } else toast(result.error, "bad");
    });
  }

  const low = left < limit * 0.1;
  return (
    <div className="a-sandbar" role="note">
      <strong>TRAINING LAB</strong>
      <span>Pretend shop: no customer sees it, and no email or message is ever sent.</span>
      <span className={low ? "a-sandbar-low" : undefined}>
        {left.toLocaleString("en-PK")} of {limit.toLocaleString("en-PK")} clicks left today
      </span>
      <button type="button" className="a-sandbar-btn" onClick={() => setAsking(true)} disabled={action.pending} aria-busy={action.pending}>
        {action.pending ? <span className="spinner" aria-hidden="true" /> : null} Start again
      </button>
      <a className="a-sandbar-btn" href={adminUrl} target="_blank" rel="noopener noreferrer">
        Real admin ↗
      </a>
      {asking && (
        <Dialog title="Start again?" onClose={() => setAsking(false)}>
          <p style={{ margin: "0 0 14px" }}>Every product, order and setting in the lab goes back to how it was at the beginning, for everyone using the lab. Your real shop is not touched.</p>
          <div className="a-row" style={{ gap: 10 }}>
            <button type="button" className="a-btn a-btn-primary" onClick={() => void reset()}>
              Yes, start again
            </button>
            <button type="button" className="a-btn" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
