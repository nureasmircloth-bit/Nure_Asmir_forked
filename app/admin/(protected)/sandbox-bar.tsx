"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, Dialog, useToast } from "../_ui/client";

/** The orange strip across the top of the practice shop: it can never be mistaken for the real shop, and says how much practice is left today. */
export function SandboxBar({ left, limit }: { left: number; limit: number }) {
  const router = useRouter();
  const toast = useToast();
  const action = useLockedAction();
  const [asking, setAsking] = useState(false);

  async function leave() {
    await action.run(async () => {
      await callApi("/api/admin/practice/exit", "POST");
      window.location.assign("/admin"); // a full page load: back to the real shop
    });
  }

  async function reset() {
    setAsking(false);
    await action.run(async () => {
      const result = await callApi("/api/admin/practice/start", "POST");
      if (result.ok) {
        toast("Everything is back to the starting practice data.", "good");
        router.refresh();
      } else toast(result.error, "bad");
    });
  }

  const low = left < limit * 0.1;
  return (
    <div className="a-sandbar" role="note">
      <strong>PRACTICE SHOP</strong>
      <span>Nothing here is real: no customer sees it, no email or message is sent.</span>
      <span className={low ? "a-sandbar-low" : undefined}>
        {left.toLocaleString("en-PK")} of {limit.toLocaleString("en-PK")} clicks left today
      </span>
      <button type="button" className="a-sandbar-btn" onClick={() => setAsking(true)} disabled={action.pending} aria-busy={action.pending}>
        {action.pending ? <span className="spinner" aria-hidden="true" /> : null} Start again
      </button>
      <button type="button" className="a-sandbar-btn" onClick={() => void leave()} disabled={action.pending}>
        Leave practice
      </button>
      {asking && (
        <Dialog title="Start again?" onClose={() => setAsking(false)}>
          <p style={{ margin: "0 0 14px" }}>Every product, order and setting you changed while practising goes back to how it was at the beginning. Your real shop is not touched.</p>
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
