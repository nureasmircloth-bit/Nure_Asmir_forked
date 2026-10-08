"use client";

import { useCallback, useEffect, useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { customEmailHtml, fillPreset, MESSAGE_PRESETS } from "@/lib/messages";
import { callApi, Dialog, Hint, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { Note, when } from "../../_ui/ui";

type Overview = {
  pushReady: boolean;
  devices: number;
  saleAlertDevices: number;
  adminDevices: number;
  subscribers: number;
  allowance: { limit: number; used: number; left: number; providers: number };
  history: Array<{ id: string; kind: string; audience: string; title: string; recipients: number; delivered: number; createdAt: string }>;
};
type SendStep = { messageId: string; total: number; delivered: number; next: number; done: boolean };
type Lookup = { orderNumber: string; name: string; email: string | null; phone: string };

const PAGES: Array<[string, string]> = [
  ["/shop", "New arrivals (the shop)"],
  ["/", "Home page"],
];

const AUDIENCE_LABEL: Record<string, string> = { all: "Everyone with notifications on", sales: "People who asked for sale alerts", test: "My own devices (test)", list: "Email list", one: "One customer" };

export function MessagesClient() {
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"push" | "email">("push");

  const load = useCallback(async () => {
    const result = await callApi<Overview>("/api/admin/messages", "GET");
    if (result.ok) setOverview(result.data);
    else toast(result.error, "bad");
  }, [toast]);
  useEffect(() => {
    // fetch on arrival; the page has nothing to show until it is here
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="a-stack">
      <div className="a-seg" role="tablist" aria-label="Kind of message">
        <button type="button" role="tab" aria-selected={tab === "push"} className={tab === "push" ? "on" : ""} onClick={() => setTab("push")}>
          <Icon name="bell" size={18} /> Notification
        </button>
        <button type="button" role="tab" aria-selected={tab === "email"} className={tab === "email" ? "on" : ""} onClick={() => setTab("email")}>
          <Icon name="mail" size={18} /> Email
        </button>
      </div>

      {tab === "push" ? <PushForm overview={overview} onSent={load} /> : <EmailForm overview={overview} onSent={load} />}

      <section className="a-card">
        <header className="a-card-head">
          <h2>Sent recently</h2>
        </header>
        {overview?.history.length ? (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Message</th>
                  <th>To</th>
                  <th>Reached</th>
                </tr>
              </thead>
              <tbody>
                {overview.history.map((row) => (
                  <tr key={row.id}>
                    <td>{when(row.createdAt)}</td>
                    <td>{row.kind === "push" ? "Notification" : "Email"}</td>
                    <td>{row.title}</td>
                    <td>{AUDIENCE_LABEL[row.audience] ?? row.audience}</td>
                    <td>
                      {row.delivered} of {row.recipients}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="a-card-pad a-muted">{overview ? "Nothing sent yet." : "Loading…"}</p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ notification ------------------------------ */

function PushForm({ overview, onSent }: { overview: Overview | null; onSent: () => void }) {
  const toast = useToast();
  const sending = useLockedAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [page, setPage] = useState("/shop");
  const [audience, setAudience] = useState<"all" | "sales" | "test">("sales");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState("");

  const reach = audience === "all" ? overview?.devices : audience === "sales" ? overview?.saleAlertDevices : overview?.adminDevices;

  async function send() {
    setConfirming(false);
    await sending.run(async () => {
      let offset = 0;
      let messageId: string | undefined;
      let delivered = 0;
      for (let guard = 0; guard < 500; guard++) {
        const result = await callApi<SendStep>("/api/admin/messages/push", "POST", { title, body, url: page, audience, offset, messageId });
        if (!result.ok) {
          toast(result.error, "bad");
          setProgress("");
          onSent();
          return;
        }
        messageId = result.data.messageId;
        delivered += result.data.delivered;
        offset = result.data.next;
        setProgress(result.data.total ? `Sent to ${delivered} of ${result.data.total}…` : "");
        if (result.data.done) break;
      }
      setProgress("");
      toast(audience === "test" ? `Test sent to ${delivered} of your devices.` : `Notification sent to ${delivered} phones.`, "good");
      if (audience !== "test") {
        setTitle("");
        setBody("");
      }
      onSent();
    });
  }

  const ready = title.trim() && body.trim();
  return (
    <section className="a-card">
      <header className="a-card-head">
        <div>
          <h2>Notification to shoppers</h2>
          <small>Appears on the phone like a message, even when your website is closed. Only people who turned notifications on get it.</small>
        </div>
      </header>
      <div className="a-card-pad a-msg-grid">
        <div className="a-form-grid">
          {overview && !overview.pushReady && (
            <div className="wide">
              <Note tone="warn">Notifications are not connected yet, so nothing can be sent. Ask your developer to add the Firebase key.</Note>
            </div>
          )}
          <div className="a-field wide">
            <label htmlFor="push-title">Title</label>
            <input id="push-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} placeholder="Eid sale starts tonight" />
          </div>
          <div className="a-field wide">
            <label htmlFor="push-body">Message</label>
            <textarea id="push-body" rows={3} value={body} onChange={(event) => setBody(event.target.value)} maxLength={180} placeholder="Up to 30% off on kameez shalwar until Sunday." />
            <span className="a-help">{body.length} of 180 letters</span>
          </div>
          <div className="a-field wide">
            <label htmlFor="push-page">
              When they tap it, open <Hint text="The page of your website the shopper lands on." />
            </label>
            <select id="push-page" value={page} onChange={(event) => setPage(event.target.value)}>
              {PAGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="wide" style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 10 }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Who gets it</legend>
            <label className="a-check">
              <input type="radio" name="push-audience" checked={audience === "sales"} onChange={() => setAudience("sales")} />
              <span>
                <strong>People who asked for sale alerts</strong>
                <small className="a-help" style={{ display: "block" }}>{overview ? `${overview.saleAlertDevices} phones` : "…"} — best for offers.</small>
              </span>
            </label>
            <label className="a-check">
              <input type="radio" name="push-audience" checked={audience === "all"} onChange={() => setAudience("all")} />
              <span>
                <strong>Everyone with notifications on</strong>
                <small className="a-help" style={{ display: "block" }}>{overview ? `${overview.devices} phones` : "…"} — including people who only wanted order updates, so use it sparingly.</small>
              </span>
            </label>
            <label className="a-check">
              <input type="radio" name="push-audience" checked={audience === "test"} onChange={() => setAudience("test")} />
              <span>
                <strong>Only my own devices (a test)</strong>
                <small className="a-help" style={{ display: "block" }}>{overview ? `${overview.adminDevices} of your devices` : "…"} — see how it looks before sending to shoppers.</small>
              </span>
            </label>
          </fieldset>
          <div className="wide a-row" style={{ gap: 12 }}>
            <button
              type="button"
              className="a-btn a-btn-primary"
              disabled={!ready || sending.pending || !overview?.pushReady || !reach}
              aria-busy={sending.pending}
              onClick={() => (audience === "test" ? void send() : setConfirming(true))}
            >
              {sending.pending ? <span className="spinner spinner-light" aria-hidden="true" /> : <Icon name="send" size={16} />} {audience === "test" ? "Send a test" : "Send now"}
            </button>
            {progress && <span className="a-muted" role="status">{progress}</span>}
            {overview && !reach && <span className="a-muted">Nobody to send to yet.</span>}
          </div>
        </div>
        <div>
          <p className="a-help" style={{ marginTop: 0 }}>How it looks on a phone</p>
          <div className="a-notif">
            <div className="a-notif-icon">NA</div>
            <div>
              <strong>{title || "Your title"}</strong>
              <p>{body || "Your message appears here."}</p>
            </div>
          </div>
        </div>
      </div>
      {confirming && (
        <Dialog title="Send this notification?" onClose={() => setConfirming(false)}>
          <p style={{ margin: "0 0 14px" }}>
            It goes to about <strong>{reach}</strong> phones. A notification cannot be taken back once it is sent.
          </p>
          <div className="a-row" style={{ gap: 10 }}>
            <button type="button" className="a-btn a-btn-primary" onClick={() => void send()}>
              Yes, send it
            </button>
            <button type="button" className="a-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/* ---------------------------------- email ---------------------------------- */

function EmailForm({ overview, onSent }: { overview: Overview | null; onSent: () => void }) {
  const toast = useToast();
  const sending = useLockedAction();
  const looking = useLockedAction();
  const [mode, setMode] = useState<"one" | "list">("one");
  const [orderNumber, setOrderNumber] = useState("");
  const [customer, setCustomer] = useState<Lookup | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState("");

  async function lookup() {
    await looking.run(async () => {
      const result = await callApi<{ order: Lookup }>(`/api/admin/messages/lookup?order=${encodeURIComponent(orderNumber)}`, "GET");
      if (!result.ok) {
        toast(result.error, "bad");
        setCustomer(null);
        return;
      }
      setCustomer(result.data.order);
      setTo(result.data.order.email ?? "");
      if (!result.data.order.email) toast("This customer did not give an email address. You can reply on WhatsApp instead.", "info");
    });
  }

  function applyPreset(id: string) {
    const preset = MESSAGE_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    const values = { name: customer?.name.split(" ")[0], order: customer?.orderNumber };
    setSubject(fillPreset(preset.subject, values));
    setBody(fillPreset(preset.body, values));
  }

  async function send() {
    setConfirming(false);
    await sending.run(async () => {
      let offset = 0;
      let messageId: string | undefined;
      let delivered = 0;
      for (let guard = 0; guard < 500; guard++) {
        const result = await callApi<SendStep>("/api/admin/messages/email", "POST", { mode, to: mode === "one" ? to : undefined, subject, body, buttonLabel: buttonLabel || undefined, buttonUrl: buttonUrl || undefined, offset, messageId });
        if (!result.ok) {
          toast(result.error, "bad");
          setProgress("");
          onSent();
          return;
        }
        messageId = result.data.messageId;
        delivered += result.data.delivered;
        offset = result.data.next;
        setProgress(`Sent ${delivered} of ${result.data.total}…`);
        if (result.data.done) break;
      }
      setProgress("");
      toast(mode === "one" ? "Email sent." : `Email sent to ${delivered} people.`, "good");
      setSubject("");
      setBody("");
      setButtonLabel("");
      setButtonUrl("");
      onSent();
    });
  }

  const html = customEmailHtml({ subject: subject || "Your subject", body: body || "Your message appears here.", buttonLabel, buttonUrl, unsubscribeUrl: mode === "list" ? "#" : undefined });
  const whatsapp = customer?.phone ? `https://wa.me/${customer.phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(body)}` : "";
  const ready = subject.trim() && body.trim() && (mode === "list" || to.trim());
  const left = overview?.allowance.left ?? 0;

  return (
    <section className="a-card">
      <header className="a-card-head">
        <div>
          <h2>Email</h2>
          <small>
            {overview ? (overview.allowance.providers ? `About ${left} free emails left today (of ${overview.allowance.limit}).` : "Email is not connected yet.") : "Loading…"}
          </small>
        </div>
      </header>
      <div className="a-card-pad a-msg-grid">
        <div className="a-form-grid">
          <fieldset className="wide" style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 10 }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Write to</legend>
            <label className="a-check">
              <input type="radio" name="email-mode" checked={mode === "one"} onChange={() => setMode("one")} />
              <span>
                <strong>One customer</strong>
                <small className="a-help" style={{ display: "block" }}>A reply about their order, or any private message.</small>
              </span>
            </label>
            <label className="a-check">
              <input type="radio" name="email-mode" checked={mode === "list"} onChange={() => setMode("list")} />
              <span>
                <strong>Everyone on my email list</strong>
                <small className="a-help" style={{ display: "block" }}>{overview ? `${overview.subscribers} people` : "…"} who joined on your website. Every email has an unsubscribe link.</small>
              </span>
            </label>
          </fieldset>

          {mode === "one" && (
            <>
              <div className="a-field">
                <label htmlFor="mail-order">Order number (optional)</label>
                <div className="a-row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <input id="mail-order" style={{ flex: 1, minWidth: 0 }} value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="NA-10234" onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), void lookup())} />
                  <button type="button" className="a-btn" onClick={() => void lookup()} disabled={!orderNumber.trim() || looking.pending}>
                    {looking.pending ? <span className="spinner" aria-hidden="true" /> : null} Find
                  </button>
                </div>
                {customer && (
                  <span className="a-help">
                    {customer.name} · {customer.phone}
                    {customer.email ? ` · ${customer.email}` : " · no email"}
                  </span>
                )}
              </div>
              <div className="a-field">
                <label htmlFor="mail-to">Their email address</label>
                <input id="mail-to" type="email" value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@example.com" />
              </div>
              <div className="a-field wide">
                <label htmlFor="mail-preset">Start from a ready-made reply</label>
                <select id="mail-preset" value="" onChange={(event) => applyPreset(event.target.value)}>
                  <option value="">Choose one (optional)…</option>
                  {MESSAGE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="a-field wide">
            <label htmlFor="mail-subject">Subject</label>
            <input id="mail-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={120} />
          </div>
          <div className="a-field wide">
            <label htmlFor="mail-body">Message</label>
            <textarea id="mail-body" rows={9} value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} />
            <span className="a-help">Leave an empty line between paragraphs.</span>
          </div>
          <div className="a-field">
            <label htmlFor="mail-btn">Button words (optional)</label>
            <input id="mail-btn" value={buttonLabel} onChange={(event) => setButtonLabel(event.target.value)} maxLength={40} placeholder="Shop the sale" />
          </div>
          <div className="a-field">
            <label htmlFor="mail-url">Button goes to (optional)</label>
            <input id="mail-url" value={buttonUrl} onChange={(event) => setButtonUrl(event.target.value)} placeholder="https://nureasmir.com/shop" />
          </div>
          <div className="wide a-row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="a-btn a-btn-primary"
              disabled={!ready || sending.pending || !overview?.allowance.providers}
              aria-busy={sending.pending}
              onClick={() => (mode === "list" ? setConfirming(true) : void send())}
            >
              {sending.pending ? <span className="spinner spinner-light" aria-hidden="true" /> : <Icon name="send" size={16} />} Send email
            </button>
            {mode === "one" && whatsapp && (
              <a className="a-btn" href={whatsapp} target="_blank" rel="noopener noreferrer">
                <Icon name="whatsapp" size={16} /> Reply on WhatsApp instead
              </a>
            )}
            {progress && <span className="a-muted" role="status">{progress}</span>}
          </div>
        </div>
        <div>
          <p className="a-help" style={{ marginTop: 0 }}>How the email looks</p>
          {/* every character typed above is escaped by customEmailHtml, so this can only ever show text */}
          <div className="a-mail-preview" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
      {confirming && (
        <Dialog title="Send this email to your whole list?" onClose={() => setConfirming(false)}>
          <p style={{ margin: "0 0 14px" }}>
            It goes to <strong>{overview?.subscribers}</strong> people and uses that many of today&apos;s free emails ({left} left). It cannot be taken back.
          </p>
          <div className="a-row" style={{ gap: 10 }}>
            <button type="button" className="a-btn a-btn-primary" onClick={() => void send()}>
              Yes, send it
            </button>
            <button type="button" className="a-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
