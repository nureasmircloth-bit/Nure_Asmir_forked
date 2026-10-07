"use client";

import { useMemo, useState } from "react";
import { googleSearchUrl, seoChecklist, serpPreview, suggestKeywords, type SeoInput } from "@/lib/seo-keywords";
import { Hint, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";

/**
 * "Be found on Google and AI assistants": the phrases shoppers type, how the page will look in a Google result, and a
 * checklist the owner can tick off while adding the product. Everything updates as they type; nothing is sent anywhere.
 */
export type SeoDraft = { title: string; description: string; keywords: string; /** the owner wrote or changed the Google text by hand */ edited: boolean; locked: boolean };

export function SeoPanel({ input, seo, onChange, onWrite, writing }: { input: SeoInput; seo: SeoDraft; onChange: (patch: Partial<SeoDraft>) => void; onWrite: () => void; writing: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => suggestKeywords(input), [input]);
  const checks = useMemo(() => seoChecklist(input), [input]);
  const serp = serpPreview({ name: input.name, shortDescription: input.shortDescription, description: input.description, seoTitle: seo.title, seoDescription: seo.description });
  const keywordChips = seo.keywords.split(",").map((word) => word.trim()).filter(Boolean);
  const done = checks.filter((item) => item.ok).length;

  async function copy(phrase: string) {
    try {
      await navigator.clipboard.writeText(phrase);
      toast(`Copied “${phrase}”.`, "good");
    } catch {
      toast("Could not copy. Select the words and copy them yourself.", "bad");
    }
  }

  return (
    <section className="a-card" aria-label="Be found on Google">
      <header className="a-card-head">
        <h2>
          6. Be found on Google and AI assistants{" "}
          <Hint text="These are phrases real shoppers type into Google. Using them naturally in the product name and description helps your product appear when they search. Press “Try on Google” to see what shows today." below />
        </h2>
        <small>
          {done} of {checks.length} checks done
        </small>
      </header>
      <div className="a-card-pad a-stack" style={{ gap: 18 }}>
        <div role="note" style={{ padding: "12px 14px", border: "1px solid var(--work, #c9a227)", borderRadius: 10, background: "var(--bg)", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ color: "var(--work, #c9a227)", paddingTop: 1 }}>
            <Icon name="info" size={18} />
          </span>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
            <strong>Please read: Google decides, not us.</strong> This page helps Google understand your product, but only Google chooses <em>if</em> and <em>when</em> to show it. A new product usually appears within a few days to a few weeks, and it can take <strong>up to a month</strong> (sometimes longer). If you search for it on Chrome right after saving and do not see it yet, that is normal and nothing is wrong. Once Google has listed it, searching your exact product name is the quickest way to find it.
          </p>
        </div>
        <div>
          <p className="a-help" style={{ margin: "0 0 6px" }}>How it may look on Google (a preview, not live yet)</p>
          <div style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg)", maxWidth: 620 }}>
            <div style={{ color: "#1a0dab", fontSize: 19, lineHeight: 1.3 }}>{serp.title}</div>
            <div style={{ color: "#188038", fontSize: 13 }}>nureasmir.com › products</div>
            <div style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>{serp.description}</div>
          </div>
        </div>

        <div>
          <p className="a-help" style={{ margin: "0 0 8px" }}>Checklist</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {checks.map((item) => (
              <li key={item.label} className="a-row" style={{ alignItems: "flex-start", gap: 10 }}>
                <span style={{ color: item.ok ? "var(--done)" : "var(--work)", paddingTop: 1 }}>
                  <Icon name={item.ok ? "checkCircle" : "info"} size={18} />
                </span>
                <span>
                  <strong style={{ fontWeight: item.ok ? 500 : 600 }}>{item.label}</strong>
                  {!item.ok && <small className="a-muted" style={{ display: "block" }}>{item.tip}</small>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <details style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: write the Google text yourself and add your own search words</summary>
          <div className="a-stack" style={{ gap: 14, marginTop: 14 }}>
            <p className="a-help" style={{ margin: 0 }}>
              You do not have to touch this. When you save, a title and a short description for Google are written for you automatically. Open this only if you want to choose the words yourself.
              {seo.locked || seo.edited ? " Your own words are kept: saving the product will not replace them." : ""}
            </p>
            <div className="a-field">
              <label htmlFor="seo-title">
                Title on Google <small className="a-muted">({seo.title.length}/60 – longer titles get cut off)</small>
              </label>
              <input id="seo-title" value={seo.title} maxLength={120} onChange={(event) => onChange({ title: event.target.value, edited: true })} placeholder={serp.title} />
            </div>
            <div className="a-field">
              <label htmlFor="seo-description">
                Two lines under the title <small className="a-muted">({seo.description.length}/155 – longer text gets cut off)</small>
              </label>
              <textarea id="seo-description" rows={3} value={seo.description} maxLength={320} onChange={(event) => onChange({ description: event.target.value, edited: true })} placeholder={serp.description} />
            </div>
            <div className="a-row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="a-btn a-btn-sm" onClick={onWrite} disabled={writing || !input.name.trim()}>
                {writing ? "Writing…" : "Write it for me"}
              </button>
              {(seo.locked || seo.edited) && (
                <button type="button" className="a-btn a-btn-sm a-btn-quiet" onClick={() => onChange({ title: "", description: "", edited: true, locked: false })}>
                  Let the helper handle it again
                </button>
              )}
            </div>
            <div className="a-field">
              <label htmlFor="seo-keywords">
                Your own search words <small className="a-muted">(separate with commas)</small>
              </label>
              <input id="seo-keywords" value={seo.keywords} maxLength={500} onChange={(event) => onChange({ keywords: event.target.value })} placeholder="for example: eid kurta, wash and wear shalwar kameez, wedding sherwani" />
              {keywordChips.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {keywordChips.map((word) => (
                    <span key={word} style={{ border: "1px solid var(--line)", borderRadius: 999, padding: "2px 10px", fontSize: 12.5 }}>
                      {word}
                    </span>
                  ))}
                </div>
              )}
              <span className="a-help">
                Honest note: Google ignores keyword lists, so these words do not make the product rank by themselves. They are used by this shop&apos;s own search box, are added to the product details that search engines read, and guide the writing helper. What really helps with Google is using these words naturally in the name and description above.
              </span>
            </div>
          </div>
        </details>

        {groups.length === 0 ? (
          <p className="a-muted">Type the product name and what it is, and search phrases appear here.</p>
        ) : (
          groups.map((group) => (
            <div key={group.title}>
              <p style={{ margin: "0 0 2px" }}><strong>{group.title}</strong></p>
              <p className="a-help" style={{ margin: "0 0 8px" }}>{group.why}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {group.phrases.map((phrase) => (
                  <span key={phrase} className="a-row" style={{ gap: 0, border: "1px solid var(--line)", borderRadius: 999, background: "var(--surface)", overflow: "hidden" }}>
                    <button type="button" className="a-btn a-btn-sm a-btn-quiet" style={{ borderRadius: 0 }} onClick={() => copy(phrase)} aria-expanded={open === phrase} onFocus={() => setOpen(phrase)} onBlur={() => setOpen(null)} title="Copy this phrase">
                      {phrase}
                    </button>
                    <a className="a-btn a-btn-sm a-btn-quiet" style={{ borderRadius: 0, borderLeft: "1px solid var(--line)" }} href={googleSearchUrl(phrase)} target="_blank" rel="noopener noreferrer" title="Open Google with this phrase (Pakistan) to see who is shown today" aria-label={`Try “${phrase}” on Google`}>
                      <Icon name="external" size={14} /> Try on Google
                    </a>
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
