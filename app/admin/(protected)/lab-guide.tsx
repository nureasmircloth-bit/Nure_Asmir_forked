"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../_ui/client";
import { Icon } from "../_ui/icons";
import { labById, LABS } from "@/lib/labs";

const ACTIVE_KEY = "na-lab-active";
const doneKey = (id: string) => `na-lab-done:${id}`;

/** What the trainee has already done in a lab (saved in this browser; "Start again" clears it). */
export function readDone(id: string): boolean[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(doneKey(id)) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.map(Boolean) : [];
  } catch {
    return [];
  }
}
function saveDone(id: string, done: boolean[]) {
  try {
    window.localStorage.setItem(doneKey(id), JSON.stringify(done));
  } catch {
    // storage blocked: the ticks just do not survive a reload
  }
}
export function setActiveLab(id: string | null) {
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // nothing to remember
  }
  window.dispatchEvent(new Event("na-lab-active"));
}

/**
 * The guide that stays with the trainee while they work: the steps of the lab they started, ticked off as soon as the practice shop
 * shows each step really done (checked every few seconds and when the trainee presses "Check my work"). It sits over every admin page.
 */
export function LabGuide({ lang }: { lang: "en" | "ur" }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [done, setDone] = useState<boolean[]>([]);
  const [open, setOpen] = useState(true);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const read = () => {
      let id: string | null = null;
      try {
        id = window.localStorage.getItem(ACTIVE_KEY);
      } catch {
        id = null;
      }
      const lab = id ? labById(id) : undefined;
      setActiveId(lab ? lab.id : null);
      setDone(lab ? readDone(lab.id) : []);
      setOpen(true);
    };
    read();
    window.addEventListener("na-lab-active", read);
    window.addEventListener("na-lab-reset", read);
    return () => {
      window.removeEventListener("na-lab-active", read);
      window.removeEventListener("na-lab-reset", read);
    };
  }, []);

  const lab = activeId ? labById(activeId) : undefined;
  /** Asks the server which steps are really done; null when it could not say (the reason is in `error`). */
  const fetchSteps = useCallback(async (): Promise<{ steps: boolean[] } | { error: string } | null> => {
    if (!lab) return null;
    const result = await callApi<{ steps: boolean[] }>("/api/admin/sandbox/check", "POST", { lab: lab.id });
    return result.ok ? { steps: result.data.steps ?? [] } : { error: result.error };
  }, [lab]);
  const apply = useCallback(
    (steps: boolean[]) => {
      if (!lab) return;
      setDone(steps);
      saveDone(lab.id, steps);
    },
    [lab],
  );

  async function checkNow() {
    setChecking(true);
    const result = await fetchSteps();
    setChecking(false);
    if (!result) return;
    if ("error" in result) return setMessage(result.error);
    apply(result.steps);
    setMessage(result.steps.every(Boolean) ? "" : lang === "ur" ? "Abhi yeh kaam poora nahi hua. Agla step dekhein." : "Not quite yet. Have a look at the next step.");
  }

  // look again every few seconds while the guide is open and the tab is in front
  useEffect(() => {
    if (!lab || !open) return;
    let alive = true;
    const look = () =>
      void fetchSteps().then((result) => {
        if (alive && result && "steps" in result) apply(result.steps);
      });
    look();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") look();
    }, 8000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [lab, open, fetchSteps, apply]);

  if (!lab) return null;
  const total = lab.steps.length;
  const finished = done.filter(Boolean).length;
  const complete = finished === total && total > 0;
  const nextIndex = done.findIndex((value, index) => !value && index < total);
  const current = nextIndex === -1 ? (complete ? -1 : 0) : nextIndex;
  const position = LABS.findIndex((item) => item.id === lab.id);
  const next = LABS[position + 1];

  if (!open) {
    return (
      <button type="button" className="lab-pill" onClick={() => setOpen(true)} aria-label={lang === "ur" ? "Lab guide kholein" : "Open the lab guide"}>
        <Icon name="sparkle" size={16} /> {lab.title[lang]} · {finished}/{total}
      </button>
    );
  }
  return (
    <aside className={`lab-guide${complete ? " is-complete" : ""}`} aria-label={lang === "ur" ? "Lab guide" : "Lab guide"}>
      <header>
        <span className="lab-guide-kicker">
          {lang === "ur" ? "Lab" : "Lab"} {position + 1} / {LABS.length}
        </span>
        <button type="button" className="lab-guide-x" onClick={() => setOpen(false)} aria-label={lang === "ur" ? "Chhupayein" : "Minimise the guide"}>
          <Icon name="chevron" size={16} />
        </button>
      </header>
      <h2>{lab.title[lang]}</h2>
      <div className="a-progress" aria-hidden="true">
        <span style={{ width: `${(finished / total) * 100}%` }} />
      </div>
      <p className="lab-guide-count">
        {finished} {lang === "ur" ? "/" : "of"} {total} {lang === "ur" ? "kaam mukammal" : "steps done"}
      </p>
      <ol className="lab-steps">
        {lab.steps.map((step, index) => (
          <li key={index} className={`${done[index] ? "is-done" : ""}${index === current ? " is-current" : ""}`}>
            <span className="lab-tick" aria-hidden="true">
              {done[index] ? <Icon name="check" size={14} /> : index + 1}
            </span>
            <div>
              <span>{step.text[lang]}</span>
              {index === current && !complete && (
                <Link href={step.href} className="lab-open" prefetch={false}>
                  {lang === "ur" ? "Yeh page kholein" : "Open this page"} →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      {complete ? (
        <div className="lab-done" role="status">
          <strong>{lang === "ur" ? "Shabash! Lab mukammal." : "Well done! Lab complete."}</strong>
          <div className="a-row" style={{ gap: 8, flexWrap: "wrap" }}>
            {next ? (
              <Link
                href="/admin/training/labs"
                className="a-btn a-btn-primary a-btn-sm"
                onClick={() => {
                  setActiveLab(next.id);
                }}
              >
                {lang === "ur" ? "Agla lab" : "Next lab"}: {next.title[lang]}
              </Link>
            ) : (
              <Link href="/admin/training/labs" className="a-btn a-btn-primary a-btn-sm" onClick={() => setActiveLab(null)}>
                {lang === "ur" ? "Sab labs dekhein" : "See all labs"}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="lab-actions">
          <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={() => void checkNow()} disabled={checking} aria-busy={checking}>
            {checking ? <span className="spinner spinner-light" aria-hidden="true" /> : null} {lang === "ur" ? "Mera kaam check karein" : "Check my work"}
          </button>
          <button type="button" className="a-btn a-btn-quiet a-btn-sm" onClick={() => setActiveLab(null)}>
            {lang === "ur" ? "Lab band karein" : "Stop this lab"}
          </button>
        </div>
      )}
      {message && !complete && (
        <p className="a-help" role="status">
          {message}
        </p>
      )}
    </aside>
  );
}
