"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../../../_ui/icons";
import { LABS } from "@/lib/labs";
import { readDone, setActiveLab } from "../../lab-guide";

/** The labs as cards: what each one teaches, how long it takes, and how far the trainee has got. Starting one opens the guide over the admin pages. */
export function LabsView({ lang }: { lang: "en" | "ur" }) {
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    const read = () => setProgress(Object.fromEntries(LABS.map((lab) => [lab.id, readDone(lab.id).filter(Boolean).length])));
    read();
    window.addEventListener("na-lab-reset", read);
    window.addEventListener("na-lab-active", read);
    return () => {
      window.removeEventListener("na-lab-reset", read);
      window.removeEventListener("na-lab-active", read);
    };
  }, []);

  return (
    <div className="lab-grid">
      {LABS.map((lab, index) => {
        const done = progress[lab.id] ?? 0;
        const total = lab.steps.length;
        const complete = done === total;
        return (
          <article key={lab.id} className={`a-card lab-card${complete ? " is-complete" : ""}`} style={{ animationDelay: `${index * 50}ms` }}>
            <div className="a-card-pad">
              <p className="lab-card-kicker">
                Lab {index + 1} · {lab.minutes} {lang === "ur" ? "minute" : "min"}
              </p>
              <h2>{lab.title[lang]}</h2>
              <p className="a-muted">{lab.goal[lang]}</p>
              <div className="lab-card-foot">
                <span className="lab-card-status">
                  {complete ? (
                    <>
                      <Icon name="checkCircle" size={16} /> {lang === "ur" ? "Mukammal" : "Done"}
                    </>
                  ) : done > 0 ? (
                    `${done} ${lang === "ur" ? "/" : "of"} ${total}`
                  ) : (
                    `${total} ${lang === "ur" ? "kaam" : "steps"}`
                  )}
                </span>
                <button
                  type="button"
                  className="a-btn a-btn-primary a-btn-sm"
                  onClick={() => {
                    setActiveLab(lab.id);
                    router.push(lab.steps[Math.min(done, total - 1)].href);
                  }}
                >
                  {complete ? (lang === "ur" ? "Dobara karein" : "Do it again") : done > 0 ? (lang === "ur" ? "Jaari rakhein" : "Continue") : lang === "ur" ? "Lab shuru karein" : "Start this lab"}
                </button>
              </div>
            </div>
          </article>
        );
      })}
      <article className="a-card lab-card lab-card-free" style={{ animationDelay: `${LABS.length * 50}ms` }}>
        <div className="a-card-pad">
          <p className="lab-card-kicker">{lang === "ur" ? "Azad practice" : "Free practice"}</p>
          <h2>{lang === "ur" ? "Jo chahein karein" : "Try anything you like"}</h2>
          <p className="a-muted">
            {lang === "ur"
              ? "Koi lab nahi, koi check nahi. Admin ki har screen kholein, products badlein, orders cancel karein. Gadbad ho jaye to upar “Start again” dabayein."
              : "No lab, no checks. Open any screen, change products, cancel orders. If it gets messy, press “Start again” in the bar at the top."}
          </p>
          <div className="lab-card-foot">
            <span className="lab-card-status" />
            <Link href="/admin" className="a-btn a-btn-sm" onClick={() => setActiveLab(null)}>
              {lang === "ur" ? "Practice shop kholein" : "Open the practice shop"}
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}
