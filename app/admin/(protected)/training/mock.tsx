import type { ReactNode } from "react";
import { Icon } from "../../_ui/icons";
import { NAV } from "../../_ui/nav";
import { Badge as RealBadge, PageHeader } from "../../_ui/ui";
import type { TourState } from "@/lib/training-engine";

/**
 * The pretend screens are drawn with the REAL admin styles and components (same sidebar, header, cards, buttons, inputs, tables)
 * at the real laptop size, then shrunk to fit the lesson window. So what the owner learns on is exactly what they will see.
 */

export const FRAME_WIDTH = 1280;
export const FRAME_HEIGHT = 760;

type S = { s: TourState };

/** A thing the pretend cursor can point at: `data-t` is how the player finds it. */
export function T({ id, s, children, className = "", as: Tag = "span", style }: S & { id: string; children?: ReactNode; className?: string; as?: "span" | "div"; style?: React.CSSProperties }) {
  return (
    <Tag data-t={id} className={`${className}${s.hl === id ? " m-hl" : ""}`} style={style}>
      {children}
    </Tag>
  );
}

/** The real admin frame: sidebar with the real menu, the top bar with the search box, then the page. */
export function Shell({ nav, title, intro, actions, children }: { nav: string; title: string; intro?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="tf-shell">
      <aside className="adm-side tf-side" aria-hidden="true">
        <div className="adm-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={38} height={38} />
          <div className="adm-brand-text">
            <strong>Nure Asmir</strong>
            <span>Shop manager</span>
          </div>
          <span className="a-icon-btn adm-fold">
            <Icon name="panel" size={20} />
          </span>
        </div>
        <div className="adm-side-scroll">
        <nav className="adm-nav">
          {NAV.map((group, index) => (
            <div key={group.label ?? index} style={{ display: "grid", gap: 2 }}>
              {group.label && <p className="adm-nav-label">{group.label}</p>}
              {group.items.map((item) => (
                <a key={item.href} aria-current={item.label === nav ? "page" : undefined}>
                  <Icon name={item.icon} />
                  <span className="adm-nav-text">{item.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        </div>
      </aside>
      <div className="adm-main tf-main">
        <div className="adm-top" style={{ position: "static" }} aria-hidden="true">
          <span className="adm-search-btn">
            <Icon name="search" size={18} />
            Search orders, customers, products…
            <kbd>Ctrl K</kbd>
          </span>
          <div className="adm-top-right">
            <span className="a-btn a-btn-sm">View shop</span>
          </div>
        </div>
        <main className="adm-page tf-page">
          <PageHeader title={title} intro={intro} actions={actions} />
          <div className="a-stack">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function Btn({ id, s, children, primary, quiet }: S & { id: string; children: ReactNode; primary?: boolean; quiet?: boolean }) {
  return (
    <T id={id} s={s} className={`a-btn${primary ? " a-btn-primary" : ""}${quiet ? " a-btn-quiet" : ""}`}>
      {children}
    </T>
  );
}

/** A real text box that shows what has been typed so far (state key `k`) or its placeholder. */
export function Field({ id, s, k, label, placeholder, wide, w }: S & { id: string; k: string; label?: string; placeholder?: string; wide?: boolean; w?: number }) {
  return (
    <div className="a-field" style={{ gridColumn: wide ? "1 / -1" : undefined, width: w }}>
      {label && <label>{label}</label>}
      <T id={id} s={s} as="div" className={s.hl === id ? "tf-focus" : ""}>
        <input readOnly tabIndex={-1} value={s[k] ?? ""} placeholder={placeholder} style={{ width: "100%" }} />
      </T>
    </div>
  );
}

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="a-card">
      {title && (
        <header className="a-card-head">
          <h2>{title}</h2>
          {right}
        </header>
      )}
      <div className="a-card-pad a-stack" style={{ gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

export function Chip({ children, on, id, s }: { children: ReactNode; on?: boolean; id?: string; s?: TourState }) {
  return id && s ? (
    <T id={id} s={s} className={`tf-chip${on ? " on" : ""}`}>
      {children}
    </T>
  ) : (
    <span className={`tf-chip${on ? " on" : ""}`}>{children}</span>
  );
}

export function Badge({ tone, children }: { tone: "new" | "work" | "ship" | "done" | "bad" | "muted"; children: ReactNode }) {
  return <RealBadge tone={tone}>{children}</RealBadge>;
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="a-note">
      <Icon name="info" />
      <div>{children}</div>
    </div>
  );
}

export function Grid({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return <div className="a-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}
