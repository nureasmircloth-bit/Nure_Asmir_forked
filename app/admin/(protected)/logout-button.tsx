"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icon } from "../_ui/icons";

export function LogoutButton({ to = "/admin/login", compact = false }: { to?: string; compact?: boolean }) {
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

  if (compact) {
    return (
      <button
        type="button"
        className="a-icon-btn"
        onClick={logout}
        disabled={busy}
        aria-busy={busy}
        title={busy ? "Signing out…" : "Sign out"}
        aria-label="Sign out"
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="logout" size={17} />}
      </button>
    );
  }

  return (
    <button type="button" className="a-btn a-btn-quiet" onClick={logout} disabled={busy} style={{ justifyContent: "flex-start" }}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
