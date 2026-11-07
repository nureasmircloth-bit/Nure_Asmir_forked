"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { DEFAULT_LIFETIME, DEFAULT_SCOPES, LIFETIMES, SCOPES, type LifetimeKey, type Scope, type TokenState } from "@/lib/mcp/token";
import { callApi, Dialog, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { Badge, EmptyState } from "../../_ui/ui";

export type TokenRow = {
  id: string;
  label: string;
  prefix: string;
  scopes: Scope[];
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  useCount: number;
  state: TokenState;
};
type Created = { token: string; label: string; expiresAt: number };

/** A moment as “6 Nov, 18:30” in Pakistan time. */
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STATE: Record<TokenState, { tone: "done" | "muted" | "bad"; text: string }> = {
  active: { tone: "done", text: "Working" },
  expired: { tone: "muted", text: "Time is up" },
  revoked: { tone: "bad", text: "Switched off" },
};

/** The ready-to-paste lines for the assistants that take a token (Claude Code, Gemini CLI). */
const claudeLine = (endpoint: string, token: string) => `claude mcp add --transport http nure-asmir ${endpoint} --header "Authorization: Bearer ${token}"`;
/** The settings block for Gemini CLI, with the real token in it. */
const geminiJson = (endpoint: string, token: string) => JSON.stringify({ mcpServers: { "nure-asmir": { httpUrl: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

/** The list of tokens with the dialogs to make one (shown once, with ready-to-copy lines) and to switch one off. */
export function AiAccessManager({ initial, endpoint }: { initial: TokenRow[]; endpoint: string }) {
  const router = useRouter();
  const toast = useToast();
  const saver = useLockedAction();
  const stopper = useLockedAction();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(DEFAULT_SCOPES);
  const [lifetime, setLifetime] = useState<LifetimeKey>(DEFAULT_LIFETIME);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [stopping, setStopping] = useState<TokenRow | null>(null);

  async function create() {
    setError("");
    await saver.run(async () => {
      const result = await callApi<Created>("/api/admin/mcp-tokens", "POST", { label, scopes, lifetime });
      if (!result.ok) return setError(result.error);
      setCreating(false);
      setCreated(result.data);
      setLabel("");
      router.refresh();
    });
  }

  /** Switches the chosen token off. Its own lock (not the one of “Make the token”), so pressing the button twice sends one request. */
  async function stop() {
    if (!stopping) return;
    await stopper.run(async () => {
      const result = await callApi(`/api/admin/mcp-tokens/${stopping.id}`, "DELETE");
      if (result.ok) {
        toast("Switched off.", "good");
        router.refresh();
      } else toast(result.error, "bad");
      setStopping(null);
    });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`, "good");
    } catch {
      toast("Could not copy. Select the text and copy it by hand.", "bad");
    }
  }

  const toggleScope = (scope: Scope) => setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));

  return (
    <div className="a-stack">
      <div className="a-row">
        <button type="button" className="a-btn a-btn-primary" onClick={() => { setError(""); setCreating(true); }}>
          <Icon name="plus" /> Give access to an assistant
        </button>
      </div>

      <section className="a-card">
        {initial.length ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {initial.map((row, index) => (
              <li key={row.id} className="a-row" style={{ padding: "16px 20px", borderTop: index ? "1px solid var(--line)" : 0, alignItems: "flex-start", opacity: row.state === "active" ? 1 : 0.65 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {row.label} <Badge tone={STATE[row.state].tone}>{STATE[row.state].text}</Badge>
                  </strong>
                  <p className="a-muted" style={{ marginTop: 4 }}>
                    <code>{row.prefix}</code> · may look at: {row.scopes.map((scope) => SCOPES[scope]).join("; ")}
                  </p>
                  <p className="a-muted" style={{ marginTop: 2 }}>
                    Made {when(row.createdAt)} by {row.createdBy} · {row.state === "active" ? `works until ${when(row.expiresAt)}` : `ended ${when(row.expiresAt)}`} ·{" "}
                    {row.lastUsedAt ? `last used ${when(row.lastUsedAt)} (${row.useCount} requests)` : "not used yet"}
                  </p>
                </div>
                {row.state === "active" && (
                  <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={() => setStopping(row)}>Switch off</button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="lock" title="No assistant has access">Press “Give access to an assistant” to make the first token.</EmptyState>
        )}
      </section>

      {creating && (
        <Dialog title="Give access to an assistant" onClose={() => setCreating(false)}>
          <form className="a-stack" style={{ gap: 14 }} onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <div className="a-field">
              <label htmlFor="ai-label">Name (so you remember it)</label>
              <input id="ai-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} placeholder="Claude on my laptop" autoFocus />
            </div>
            <fieldset className="a-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>What may it look at?</legend>
              {(Object.keys(SCOPES) as Scope[]).map((scope) => (
                <label key={scope} className="a-row" style={{ gap: 8, alignItems: "flex-start", marginTop: 6 }}>
                  <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} style={{ marginTop: 3 }} />
                  <span>{SCOPES[scope]}</span>
                </label>
              ))}
              <span className="a-help">It can only look. It cannot change anything.</span>
            </fieldset>
            <div className="a-field">
              <label htmlFor="ai-life">How long should it work?</label>
              <select id="ai-life" value={lifetime} onChange={(event) => setLifetime(event.target.value as LifetimeKey)}>
                {LIFETIMES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
            {error && <p className="a-error" role="alert">{error}</p>}
            <div className="a-dialog-actions">
              <button type="button" className="a-btn" onClick={() => setCreating(false)}>Cancel</button>
              <button className="a-btn a-btn-primary" disabled={saver.pending || !scopes.length} aria-busy={saver.pending}>{saver.pending ? "Making…" : "Make the token"}</button>
            </div>
          </form>
        </Dialog>
      )}

      {created && (
        <Dialog title="Copy your token now" onClose={() => setCreated(null)}>
          <div className="a-stack" style={{ gap: 12 }}>
            <p><strong>This is the only time you will see it.</strong> If you lose it, switch it off and make a new one. It works until {when(created.expiresAt)}.</p>
            <div className="a-field">
              <label htmlFor="ai-token">Token</label>
              <input id="ai-token" readOnly value={created.token} onFocus={(event) => event.currentTarget.select()} />
            </div>
            <div className="a-row" style={{ flexWrap: "wrap" }}>
              <button type="button" className="a-btn a-btn-primary" onClick={() => copy(created.token, "Token")}><Icon name="copy" /> Copy the token</button>
              <button type="button" className="a-btn" onClick={() => copy(claudeLine(endpoint, created.token), "Claude Code line")}>Copy the line for Claude Code</button>
              <button type="button" className="a-btn" onClick={() => copy(geminiJson(endpoint, created.token), "Gemini CLI settings")}>Copy the settings for Gemini CLI</button>
            </div>
            <p className="a-muted">Address of the connection: <code>{endpoint}</code></p>
            <div className="a-dialog-actions">
              <button type="button" className="a-btn a-btn-primary" onClick={() => setCreated(null)}>I have copied it</button>
            </div>
          </div>
        </Dialog>
      )}

      {stopping && (
        <Dialog title="Switch this token off?" onClose={() => setStopping(null)}>
          <p>“{stopping.label}” will stop working at once. The assistant will have to be given a new token to look at your shop again.</p>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={() => setStopping(null)}>Go back</button>
            <button type="button" className="a-btn a-btn-danger" onClick={stop} disabled={stopper.pending} aria-busy={stopper.pending}>{stopper.pending ? "Switching off…" : "Switch off"}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
