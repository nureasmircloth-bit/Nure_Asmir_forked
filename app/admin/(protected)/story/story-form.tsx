"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { StoryBody } from "@/components/story-body";
import { useLockedAction } from "@/lib/use-locked-action";
import { Hint, callApi, useToast } from "../../_ui/client";

export function StoryForm({ initialHeading, initialBody, defaultHeading, defaultBody }: { initialHeading: string; initialBody: string; defaultHeading: string; defaultBody: string }) {
  const router = useRouter();
  const toast = useToast();
  const saving = useLockedAction();
  const [heading, setHeading] = useState(initialHeading);
  const [body, setBody] = useState(initialBody);
  const [saved, setSaved] = useState({ heading: initialHeading, body: initialBody });
  const dirty = heading !== saved.heading || body !== saved.body;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!heading.trim() || !body.trim()) {
      toast("Please write a heading and some text first.", "bad");
      return;
    }
    await saving.run(async () => {
      // Saving the original wording stores nothing, so later improvements to the standard text are picked up too.
      const result = await callApi("/api/admin/settings", "PATCH", {
        aboutHeading: heading.trim() === defaultHeading ? "" : heading.trim(),
        aboutBody: body.trim() === defaultBody ? "" : body,
      });
      if (result.ok) {
        setSaved({ heading, body });
        toast("Our story page saved.", "good");
        router.refresh();
      } else toast(result.error, "bad");
    });
  }

  return (
    <form onSubmit={save} className="a-story">
      <section className="a-card">
        <header className="a-card-head">
          <div>
            <h2>Write your story</h2>
            <small>Leave an empty line between paragraphs.</small>
          </div>
        </header>
        <div className="a-card-pad a-form-grid">
          <div className="a-field wide">
            <label htmlFor="story-heading">Big heading</label>
            <input id="story-heading" value={heading} onChange={(event) => setHeading(event.target.value)} maxLength={120} />
          </div>
          <div className="a-field wide">
            <label htmlFor="story-body">
              Text <Hint text="Start a paragraph with > to show it as the large quote. To add a link write [words to click](/contact) or [words](https://example.com)." />
            </label>
            <textarea id="story-body" rows={16} value={body} onChange={(event) => setBody(event.target.value)} maxLength={6000} />
            <span className="a-help">Tip: <code>&gt; Style. Heritage. Confidence.</code> makes a large quote. <code>[returns policy](/policies/returns)</code> makes a link.</span>
          </div>
          <div className="wide a-row" style={{ gap: 10, flexWrap: "wrap" }}>
            <button type="submit" className="a-btn a-btn-primary" disabled={saving.pending || !dirty} aria-busy={saving.pending}>
              {saving.pending ? <span className="spinner spinner-light" aria-hidden="true" /> : null} Save
            </button>
            <button
              type="button"
              className="a-btn a-btn-quiet"
              disabled={saving.pending || (heading === defaultHeading && body === defaultBody)}
              onClick={() => {
                setHeading(defaultHeading);
                setBody(defaultBody);
              }}
            >
              Go back to the original wording
            </button>
            <Link className="a-btn a-btn-quiet" href="/admin/pictures">
              Change the picture
            </Link>
            {dirty && <span className="a-muted">You have changes that are not saved yet.</span>}
          </div>
        </div>
      </section>

      <section className="a-card">
        <header className="a-card-head">
          <div>
            <h2>How it will look</h2>
            <small>The text part of the page, as shoppers read it.</small>
          </div>
        </header>
        <div className="a-card-pad a-story-preview">
          <p className="a-story-eyebrow">Our story</p>
          <h3>{heading || "…"}</h3>
          <StoryBody body={body} />
        </div>
      </section>
    </form>
  );
}
