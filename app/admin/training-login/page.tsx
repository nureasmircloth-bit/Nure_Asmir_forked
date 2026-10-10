"use client";

import Image from "next/image";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLockedAction } from "@/lib/use-locked-action";

function EntranceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("returnTo") || "/admin/training";
  // Only ever go back to a page inside the admin – never to an address someone put in the link.
  const returnTo = requested.startsWith("/admin") && !requested.startsWith("//") ? requested : "/admin/training";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const action = useLockedAction();
  const busy = action.pending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(() => enter());
  }

  async function enter() {
    setError("");
    try {
      const response = await fetch("/api/admin/sandbox/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Could not open the lab. Please try again.");
        return;
      }
      router.push(returnTo);
      router.refresh();
    } catch (caught) {
      console.error("training entrance failed", caught);
      setError("Could not reach the server. Please check your internet and try again.");
    }
  }

  return (
    <main className="adm-login-wrap lab-entrance">
      <div className="a-card adm-login lab-entrance-card">
        <div className="lab-entrance-badge">
          <Image src="/logo-icon.png" alt="Nure Asmir" width={56} height={56} priority />
          <span>TRAINING LAB</span>
        </div>
        <div>
          <h1>Learn the shop manager, safely</h1>
          <p className="a-muted" style={{ marginTop: 6 }}>
            A practice copy of the admin with pretend products and orders. Click anything: nothing here reaches a customer or your real shop.
          </p>
        </div>
        <ul className="lab-entrance-points">
          <li>Short lessons that show where to click</li>
          <li>Guided labs that check your work</li>
          <li>Free practice with “Start again” whenever you like</li>
        </ul>
        {/* method="post": if the form is submitted before the page has hydrated, the password must never end up in the URL. */}
        <form method="post" action="/admin/training-login" onSubmit={submit} className="a-stack" style={{ gap: 16 }}>
          <div className="a-field">
            <label htmlFor="lab-name">Your name</label>
            <input id="lab-name" required maxLength={40} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="For example: Ayesha" />
          </div>
          <div className="a-field">
            <label htmlFor="lab-password">Training password</label>
            <div style={{ position: "relative" }}>
              <input id="lab-password" required type={show ? "text" : "password"} autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} style={{ paddingRight: 84 }} />
              <button type="button" className="a-btn a-btn-quiet a-btn-sm" style={{ position: "absolute", right: 5, top: 5 }} onClick={() => setShow((value) => !value)} aria-pressed={show}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {error && (
            <p className="a-error" role="alert">
              {error}
            </p>
          )}
          <button className="a-btn a-btn-primary a-btn-lg" disabled={busy} aria-busy={busy}>
            {busy ? (
              <span className="busy-label">
                <span className="spinner spinner-light" aria-hidden="true" /> Opening the lab…
              </span>
            ) : (
              "Enter the lab"
            )}
          </button>
          <p className="a-help">Ask the shop owner for the training password. This is not your real admin sign-in.</p>
        </form>
      </div>
    </main>
  );
}

export default function TrainingLoginPage() {
  return (
    <Suspense fallback={null}>
      <EntranceForm />
    </Suspense>
  );
}
