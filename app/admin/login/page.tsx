"use client";

import Image from "next/image";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLockedAction } from "@/lib/use-locked-action";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("returnTo") || "/admin";
  // Only ever go back to a page inside the admin – never to an address someone put in the link.
  const returnTo = requested.startsWith("/admin") && !requested.startsWith("//") ? requested : "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const action = useLockedAction();
  const busy = action.pending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(() => signIn());
  }

  async function signIn() {
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "That email or password is not correct. Please try again.");
        return;
      }
      router.push(returnTo);
      router.refresh();
    } catch (caught) {
      console.error("login failed", caught);
      setError("Could not reach the server. Please check your internet and try again.");
    }
  }

  return (
    <main className="adm-login-wrap">
      <div className="a-card adm-login">
        <div>
          <Image src="/logo-icon.png" alt="Nure Asmir" width={56} height={56} priority />
        </div>
        <div>
          <h1>Welcome back</h1>
          <p className="a-muted" style={{ marginTop: 6 }}>
            Sign in to manage your shop, orders and products.
          </p>
        </div>
        {/* method="post": if the form is submitted before the page has hydrated, credentials must never end up in the URL. */}
        <form method="post" action="/admin/login" onSubmit={submit} className="a-stack" style={{ gap: 16 }}>
          <div className="a-field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@nureasmir.com" />
          </div>
          <div className="a-field">
            <label htmlFor="login-password">Password</label>
            <div style={{ position: "relative" }}>
              <input id="login-password" required type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={{ paddingRight: 84 }} />
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
                <span className="spinner spinner-light" aria-hidden="true" /> Signing in…
              </span>
            ) : (
              "Sign in"
            )}
          </button>
          <p className="a-help">Forgot your password? Ask the person who set up your shop to reset it.</p>
        </form>
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
