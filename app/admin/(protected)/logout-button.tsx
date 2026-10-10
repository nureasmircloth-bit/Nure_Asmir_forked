"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ to = "/admin/login" }: { to?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.push(to);
      router.refresh();
    } catch (error) {
      console.error("logout failed", error);
      setBusy(false);
    }
  }

  return (
    <button type="button" className="a-btn a-btn-quiet" onClick={logout} disabled={busy} style={{ justifyContent: "flex-start" }}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
