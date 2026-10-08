"use client";

import { useState } from "react";
import { showToast } from "./shop-toast";

/** Copies a value and says so: the button turns into "Copied ✓" and a message appears, so the shopper is never left guessing. */
export function CopyButton({ value, label = "Copy", doneMessage = "Copied" }: { value: string; label?: string; doneMessage?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers: select-and-copy through a hidden field.
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      if (!ok) {
        showToast("Could not copy — please select and copy it by hand.", "bad");
        return;
      }
    }
    setCopied(true);
    showToast(`${doneMessage}: ${value}`);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" className={`copy-button${copied ? " is-copied" : ""}`} onClick={copy} aria-live="polite">
      {copied ? "Copied ✓" : label}
    </button>
  );
}
