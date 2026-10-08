"use client";

import { useState } from "react";
import { Icon } from "./icons";

/** Folds the left menu away to give pages the whole width, and brings it back. Remembered in a cookie so the next page opens the same way. */
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
    <button type="button" className="a-icon-btn adm-fold" onClick={toggle} aria-pressed={collapsed} aria-label={collapsed ? "Show the menu" : "Hide the menu"} title={collapsed ? "Show the menu" : "Hide the menu to get more room"}>
      <Icon name="panel" size={20} />
    </button>
  );
}
