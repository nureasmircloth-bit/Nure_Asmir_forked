"use client";

import { useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";

export function UnsubscribeButton({ email, token }: { email: string; token: string }) {
  const action = useLockedAction();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  async function run() {
    await action.run(async () => {
      try {
        const response = await fetch("/api/newsletter/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e: email, t: token }) });
        setState(response.ok ? "done" : "error");
      } catch {
        setState("error");
      }
    });
  }

  if (state === "done") return <p role="status">Done — you are off the list. We are sorry to see you go.</p>;
  return (
    <div>
      <button type="button" className="button button-dark" onClick={run} disabled={action.pending} aria-busy={action.pending}>
        {action.pending ? <span className="spinner spinner-light" aria-label="Working" /> : "Yes, unsubscribe me"}
      </button>
      {state === "error" && <p role="alert">Something went wrong. Please try again.</p>}
    </div>
  );
}
