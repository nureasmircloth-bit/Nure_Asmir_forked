"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

/** Folds the left menu away on desktop to give pages more room. */
export function SideToggle({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    const shell = document.querySelector<HTMLElement>(".adm-shell");
    if (shell) shell.dataset.side = next ? "collapsed" : "open";
    document.cookie = `adm-side=${next ? "collapsed" : "open"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <button
      type="button"
      className="a-icon-btn adm-fold"
      onClick={toggle}
      aria-pressed={collapsed}
      aria-label={collapsed ? "Show the menu" : "Hide the menu"}
      title={collapsed ? "Show the menu" : "Hide the menu"}
    >
      <Icon name="panel" size={20} />
    </button>
  );
}

/** Toggles the off-canvas drawer on mobile & tablet devices. */
export function AdminMobileToggle() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onRoute = () => {
      setOpen(false);
      const shell = document.querySelector<HTMLElement>(".adm-shell");
      if (shell) shell.dataset.mobile = "closed";
    };
    window.addEventListener("popstate", onRoute);
    return () => window.removeEventListener("popstate", onRoute);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    const shell = document.querySelector<HTMLElement>(".adm-shell");
    if (shell) shell.dataset.mobile = next ? "open" : "closed";
  }

  return (
    <button
      type="button"
      className="adm-mobile-btn"
      onClick={toggle}
      aria-label={open ? "Close navigation menu" : "Open navigation menu"}
      aria-expanded={open}
    >
      <Icon name={open ? "x" : "menu"} size={20} />
    </button>
  );
}

/** Backdrop scrim for closing mobile drawer when tapping outside. */
export function AdminMobileScrim() {
  function close() {
    const shell = document.querySelector<HTMLElement>(".adm-shell");
    if (shell) shell.dataset.mobile = "closed";
  }

  return <div className="adm-mobile-scrim" onClick={close} aria-hidden="true" />;
}
