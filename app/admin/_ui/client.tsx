"use client";

// Interactive building blocks shared by the admin screens: toasts, plain-words hints, the collapsible
// "how this page works" box, a confirm dialog, and a button that calls the API exactly once per click.

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { storefrontDelayMessage, storefrontDelayMinutes } from "@/lib/storefront-delay";
import { useLockedAction } from "@/lib/use-locked-action";
import { Icon } from "./icons";

/* ---------------------------------- toasts ---------------------------------- */

type ToastTone = "good" | "bad" | "info";
type ToastItem = { id: number; text: string; tone: ToastTone };
const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  const counter = useRef(0);
  const push = useCallback((text: string, tone: ToastTone = "good") => {
    const id = ++counter.current;
    setItems((current) => [...current.slice(-3), { id, text, tone }]);
    // Errors stay longer: people need time to read what went wrong.
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), tone === "good" ? 4500 : 9000);
  }, []);
  // After any successful change to something shoppers see, say when it will show up: the website keeps saved copies of its pages, so
  // a change is not instant. One place watches every admin save (instead of every form promising its own, possibly wrong, time).
  useEffect(() => {
    const original = window.fetch;
    let lastAt = 0;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      try {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
        const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
        const minutes = response.ok && url.origin === window.location.origin ? storefrontDelayMinutes(url.pathname, method) : null;
        if (minutes && Date.now() - lastAt > 20_000) {
          lastAt = Date.now();
          // a moment after the form's own "Saved" message, so the two read in order
          const id = ++counter.current;
          setNote({ id, text: storefrontDelayMessage(minutes) });
          window.setTimeout(() => setNote((current) => (current?.id === id ? null : current)), 12_000);
        }
      } catch {
        // the notice is a courtesy; it must never break a save
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {note && (
        <div className="a-delay-note" role="status" aria-live="polite">
          <Icon name="info" />
          <span>{note.text}</span>
          <button type="button" aria-label="Close note" onClick={() => setNote(null)}>
            ×
          </button>
        </div>
      )}
      <div className="a-toasts" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div key={item.id} className={`a-toast ${item.tone}`} role={item.tone === "bad" ? "alert" : "status"}>
            <Icon name={item.tone === "bad" ? "alert" : "checkCircle"} />
            <span>{item.text}</span>
            <button type="button" aria-label="Close message" onClick={() => setItems((current) => current.filter((t) => t.id !== item.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ----------------------------------- hints ---------------------------------- */

/** A small (i) that explains a word or a field in plain language, on hover, focus or click. */
export function Hint({ text, below = false }: { text: string; below?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="a-hint" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="What does this mean?" aria-describedby={open ? id : undefined} aria-expanded={open} onClick={() => setOpen((v) => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
        ?
      </button>
      {open && (
        <span id={id} role="tooltip" className={`a-hint-pop${below ? " below" : ""}`}>
          {text}
        </span>
      )}
    </span>
  );
}

/** "How this page works" – open the first time, remembered as closed once the owner has read it. */
export function HelpBox({ id, title = "How this page works", children }: { id: string; title?: string; children: ReactNode }) {
  const key = `adm-help-${id}`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      // Browser-only preference; reading it after mount avoids a server/client mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(key) === "closed") setOpen(false);
    } catch {
      /* private mode: just stay open */
    }
  }, [key]);
  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(key, next ? "open" : "closed");
    } catch {
      /* ignore */
    }
  }
  return (
    <section className="a-help-box" data-open={open} aria-label={title}>
      <button type="button" onClick={toggle} aria-expanded={open}>
        <Icon name="help" />
        {title}
        <Icon name="chevron" className="chev" size={18} />
      </button>
      {open && children}
    </section>
  );
}

/* ---------------------------------- dialogs --------------------------------- */

export function Dialog({ title, children, onClose, wide = false, labelledBy }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button.a-btn-primary, button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="a-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={ref} className={`a-dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export type ConfirmOptions = { title: string; body: ReactNode; confirmLabel: string; tone?: "danger" | "primary" };

/* ------------------------------- API call helper ----------------------------- */

export type ApiResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** fetch() that always answers in plain words, even when the network or the server fails. */
export async function callApi<T = Record<string, unknown>>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE" | "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) return { ok: false, status: response.status, error: data.error ?? (response.status === 401 ? "You have been signed out. Please sign in again." : "Something went wrong. Please try again.") };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Please check your internet and try again." };
  }
}

/**
 * A button that sends one request per click: it locks and shows a spinner while working, asks first when
 * the action is risky, tells the owner in words what happened, and refreshes the page data afterwards.
 */
export function ApiButton({
  url,
  method = "POST",
  body,
  label,
  busyLabel,
  variant = "default",
  size,
  confirm,
  success,
  icon,
  disabled,
  title,
  onDone,
  refresh = true,
  className = "",
}: {
  url: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  label: ReactNode;
  busyLabel?: string;
  variant?: "default" | "primary" | "danger" | "danger-solid" | "quiet";
  size?: "sm" | "lg";
  confirm?: ConfirmOptions;
  success?: string | ((data: Record<string, unknown>) => string);
  icon?: Parameters<typeof Icon>[0]["name"];
  disabled?: boolean;
  title?: string;
  onDone?: (result: ApiResult) => void;
  refresh?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const action = useLockedAction();
  const [asking, setAsking] = useState(false);

  async function run() {
    await action.run(async () => {
      const result = await callApi(url, method, body);
      if (result.ok) {
        const text = typeof success === "function" ? success(result.data) : success;
        if (text) toast(text, "good");
        const warning = (result.data as { courierWarning?: string | null }).courierWarning;
        if (warning) toast(warning, "info");
        if (refresh) router.refresh();
      } else {
        toast(result.error, "bad");
      }
      onDone?.(result);
    });
  }

  const cls = `a-btn${variant === "primary" ? " a-btn-primary" : variant === "danger" ? " a-btn-danger" : variant === "danger-solid" ? " a-btn-danger-solid" : variant === "quiet" ? " a-btn-quiet" : ""}${size ? ` a-btn-${size}` : ""} ${className}`;
  return (
    <>
      <button type="button" className={cls} disabled={disabled || action.pending} aria-busy={action.pending} title={title} onClick={() => (confirm ? setAsking(true) : void run())}>
        {action.pending ? (
          <span className="busy-label">
            <span className={`spinner${variant === "primary" || variant === "danger-solid" ? " spinner-light" : ""}`} aria-hidden="true" /> {busyLabel ?? "Working…"}
          </span>
        ) : (
          <>
            {icon && <Icon name={icon} />}
            {label}
          </>
        )}
      </button>
      {asking && confirm && (
        <Dialog title={confirm.title} onClose={() => setAsking(false)}>
          <div className="a-muted">{confirm.body}</div>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={() => setAsking(false)}>
              No, go back
            </button>
            <button
              type="button"
              className={`a-btn ${confirm.tone === "danger" ? "a-btn-danger-solid" : "a-btn-primary"}`}
              onClick={() => {
                setAsking(false);
                void run();
              }}
            >
              {confirm.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Small confirm-less wrapper for "link-looking" quiet buttons that just refresh. */
export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const action = useLockedAction();
  return (
    <button
      type="button"
      className="a-btn a-btn-sm"
      disabled={action.pending}
      onClick={() =>
        action.run(async () => {
          router.refresh();
          await new Promise((resolve) => window.setTimeout(resolve, 600));
        })
      }
    >
      {action.pending ? <span className="spinner" aria-hidden="true" /> : null} {label}
    </button>
  );
}
