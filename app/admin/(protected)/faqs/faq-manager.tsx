"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, Dialog, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { Badge, EmptyState } from "../../_ui/ui";

export type FaqRow = { id: string; question: string; answer: string; active: boolean };
type Draft = { id?: string; question: string; answer: string };

/** Provides controls to create, edit, reorder, hide and delete storefront questions. */
export function FaqManager({ initial }: { initial: FaqRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const saver = useLockedAction();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<FaqRow | null>(null);
  const [error, setError] = useState("");

  async function save() {
    if (!editing) return;
    setError("");
    await saver.run(async () => {
      const body = { question: editing.question, answer: editing.answer };
      const result = editing.id ? await callApi(`/api/admin/faqs/${editing.id}`, "PATCH", body) : await callApi("/api/admin/faqs", "POST", body);
      if (!result.ok) return setError(result.error);
      toast(editing.id ? "Saved." : "Question added.", "good");
      setEditing(null);
      router.refresh();
    });
  }

  async function toggle(row: FaqRow) {
    const result = await callApi(`/api/admin/faqs/${row.id}`, "PATCH", { active: !row.active });
    if (result.ok) router.refresh();
    else toast(result.error, "bad");
  }

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= initial.length) return;
    const ids = initial.map((row) => row.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const result = await callApi("/api/admin/faqs/reorder", "POST", { ids });
    if (result.ok) router.refresh();
    else toast(result.error, "bad");
  }

  async function remove() {
    if (!removing) return;
    const result = await callApi(`/api/admin/faqs/${removing.id}`, "DELETE");
    if (result.ok) {
      toast("Question removed.", "good");
      router.refresh();
    } else toast(result.error, "bad");
    setRemoving(null);
  }

  return (
    <div className="a-stack">
      <div className="a-row">
        <button type="button" className="a-btn a-btn-primary" onClick={() => { setError(""); setEditing({ question: "", answer: "" }); }}>
          <Icon name="plus" /> Add a question
        </button>
      </div>

      <section className="a-card">
        {initial.length ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {initial.map((row, index) => (
              <li key={row.id} className="a-row" style={{ padding: "16px 20px", borderTop: index ? "1px solid var(--line)" : 0, alignItems: "flex-start", opacity: row.active ? 1 : 0.6 }}>
                <div className="a-row" style={{ flexDirection: "column", gap: 2 }}>
                  <button type="button" className="a-icon-btn" aria-label={`Move “${row.question}” up`} onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
                  <button type="button" className="a-icon-btn" aria-label={`Move “${row.question}” down`} onClick={() => move(index, 1)} disabled={index === initial.length - 1}>↓</button>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {row.question} {!row.active && <Badge tone="muted">Hidden</Badge>}
                  </strong>
                  <p className="a-muted" style={{ marginTop: 4, whiteSpace: "pre-line" }}>{row.answer}</p>
                </div>
                <div className="a-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button type="button" className="a-btn a-btn-sm" onClick={() => toggle(row)}>{row.active ? "Hide" : "Show"}</button>
                  <button type="button" className="a-btn a-btn-sm" onClick={() => { setError(""); setEditing({ id: row.id, question: row.question, answer: row.answer }); }}>Edit</button>
                  <button type="button" className="a-icon-btn" aria-label={`Remove “${row.question}”`} title="Remove" onClick={() => setRemoving(row)}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="info" title="No questions yet">Press “Add a question” to write your first one.</EmptyState>
        )}
      </section>

      {editing && (
        <Dialog title={editing.id ? "Edit question" : "Add a question"} onClose={() => setEditing(null)}>
          <form
            className="a-stack"
            style={{ gap: 12 }}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="a-field">
              <label htmlFor="faq-q">Question</label>
              <input id="faq-q" value={editing.question} onChange={(event) => setEditing({ ...editing, question: event.target.value })} maxLength={200} autoFocus />
            </div>
            <div className="a-field">
              <label htmlFor="faq-a">Answer</label>
              <textarea id="faq-a" rows={6} value={editing.answer} onChange={(event) => setEditing({ ...editing, answer: event.target.value })} maxLength={2000} />
              <span className="a-help">Tip: type {"{{freeAbove}}"} to show your free-delivery amount, {"{{codHours}}"} for the cash-on-delivery hold time and {"{{refundDays}}"} for the number of days a customer may ask for a refund.</span>
            </div>
            {error && <p className="a-error" role="alert">{error}</p>}
            <div className="a-dialog-actions">
              <button type="button" className="a-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="a-btn a-btn-primary" disabled={saver.pending} aria-busy={saver.pending}>{saver.pending ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </Dialog>
      )}

      {removing && (
        <Dialog title="Remove this question?" onClose={() => setRemoving(null)}>
          <p>“{removing.question}” will be deleted. (To keep it but hide it from customers, press Hide instead.)</p>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={() => setRemoving(null)}>Go back</button>
            <button type="button" className="a-btn a-btn-danger" onClick={remove}>Remove</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
