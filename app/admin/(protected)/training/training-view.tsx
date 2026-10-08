"use client";

import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { ANSWERS, ROUTINE, UI, UR, type Lang } from "@/lib/training-ur";
import { LESSONS } from "./lessons";
import { TrainingPlayer } from "./player";

/**
 * Training, in two ways: "Watch" (self-playing lessons) and "Read" (the same steps written out). Roman Urdu is the default
 * because that is how the owner reads fastest; English is one button away, and the choice is remembered in a cookie.
 */
export function TrainingView({ initialLesson, initialLang }: { initialLesson?: string; initialLang: Lang }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [tab, setTab] = useState<"watch" | "read">("watch");
  const [lesson, setLesson] = useState(initialLesson);
  const L = UI[lang];

  function choose(next: Lang) {
    setLang(next);
    document.cookie = `adm-lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh(); // the page title and introduction are written on the server: ask for them again in the new language (this view keeps its place)
  }

  // Watch / Read are tabs: left and right arrows move between them, and only the chosen one is in the tab order.
  function tabKeys(event: KeyboardEvent) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setTab((current) => (current === "watch" ? "read" : "watch"));
      document.getElementById(tab === "watch" ? "training-tab-read" : "training-tab-watch")?.focus();
    }
  }

  return (
    <>
      <div className="a-row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="a-range" role="tablist" aria-label="Training view" onKeyDown={tabKeys}>
          <button type="button" role="tab" id="training-tab-watch" aria-selected={tab === "watch"} aria-controls="training-panel-watch" tabIndex={tab === "watch" ? 0 : -1} onClick={() => setTab("watch")}>
            {L.watch}
          </button>
          <button type="button" role="tab" id="training-tab-read" aria-selected={tab === "read"} aria-controls="training-panel-read" tabIndex={tab === "read" ? 0 : -1} onClick={() => setTab("read")}>
            {L.read}
          </button>
        </div>
        <div className="a-row">
          <span className="a-muted">{L.language}</span>
          <div className="a-range" role="group" aria-label="Language">
            <button type="button" aria-pressed={lang === "ur"} onClick={() => choose("ur")}>
              Roman Urdu
            </button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => choose("en")}>
              English
            </button>
          </div>
        </div>
      </div>

      {tab === "watch" ? (
        <div id="training-panel-watch" role="tabpanel" aria-labelledby="training-tab-watch">
          {/* the player reports the lesson being watched, so coming back from "Read" returns to it (it is not remounted on every click) */}
          <TrainingPlayer lessons={LESSONS} initialLesson={lesson} lang={lang} onSelect={setLesson} />
        </div>
      ) : (
        <div className="a-stack" id="training-panel-read" role="tabpanel" aria-labelledby="training-tab-read">
          <p className="a-muted" style={{ maxWidth: 820 }}>{L.guideIntro}</p>
          {LESSONS.map((item) => {
            const text = lang === "ur" && UR[item.id] ? UR[item.id] : { title: item.title, blurb: item.blurb, steps: item.steps.map((step) => step.say) };
            return (
              <section key={item.id} className="a-card" id={`guide-${item.id}`}>
                <header className="a-card-head">
                  <div>
                    <h2>{text.title}</h2>
                    <small>{text.blurb}</small>
                  </div>
                  <button type="button" className="a-btn a-btn-sm" onClick={() => { setLesson(item.id); setTab("watch"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    {L.watchVideo}
                  </button>
                </header>
                <ol style={{ margin: 0, padding: "14px 22px 20px 44px", display: "grid", gap: 10, lineHeight: 1.6 }}>
                  {text.steps.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}

      <div className="a-split" style={{ marginTop: 22 }}>
        <section className="a-card">
          <header className="a-card-head"><h2>{L.routineTitle}</h2></header>
          <ul style={{ listStyle: "none", margin: 0, padding: "6px 22px 18px", display: "grid", gap: 12 }}>
            {ROUTINE[lang].map(([when, what]) => (
              <li key={when}><strong>{when}</strong><div className="a-muted">{what}</div></li>
            ))}
          </ul>
        </section>
        <section className="a-card">
          <header className="a-card-head"><h2>{L.answersTitle}</h2></header>
          <ul style={{ listStyle: "none", margin: 0, padding: "6px 22px 18px", display: "grid", gap: 12 }}>
            {ANSWERS[lang].map(([q, a]) => (
              <li key={q}><strong>{q}</strong><div className="a-muted">{a}</div></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
