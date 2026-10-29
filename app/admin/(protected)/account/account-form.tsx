"use client";

import { useState } from "react";
import { callApi, useToast } from "../../_ui/client";

/** Change my own password: the current one, the new one twice. */
export function AccountForm({ minLength }: { minLength: number }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (next !== again) return setError("The two new passwords are not the same.");
    setBusy(true);
    const result = await callApi("/api/admin/account/password", "POST", { currentPassword: current, newPassword: next });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCurrent("");
    setNext("");
    setAgain("");
    toast("Password changed. Other devices have been signed out.");
  }

  return (
    <form onSubmit={submit} className="a-stack" style={{ gap: 14, maxWidth: 440 }}>
      <div className="a-field">
        <label htmlFor="pw-current">Current password</label>
        <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required />
      </div>
      <div className="a-field">
        <label htmlFor="pw-new">New password</label>
        <input id="pw-new" type="password" autoComplete="new-password" minLength={minLength} value={next} onChange={(event) => setNext(event.target.value)} required />
        <small className="a-muted">At least {minLength} characters. A few unrelated words are better than a short word with numbers.</small>
      </div>
      <div className="a-field">
        <label htmlFor="pw-again">New password again</label>
        <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} required />
      </div>
      {error && <p role="alert" style={{ color: "var(--bad)", margin: 0 }}>{error}</p>}
      <div>
        <button className="a-btn a-btn-primary" disabled={busy || !current || !next || !again}>{busy ? "Saving…" : "Change password"}</button>
      </div>
    </form>
  );
}
