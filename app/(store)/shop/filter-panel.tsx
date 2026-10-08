"use client";

import { useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/lib/use-modal-focus";
import { Price } from "../_components/currency";
import { Portal } from "../_components/portal";
import { countFilters, EMPTY_FILTERS, hasFilters, type CatalogFilters } from "@/lib/catalog-filters";

export type Facets = { price: { min: number; max: number }; sizes: Array<{ value: string; count: number }>; colors: Array<{ value: string; count: number }> };


/** Best-effort swatch for a colour name (anything unknown gets a neutral dot, never a wrong one). */
const SWATCHES: Record<string, string> = {
  black: "#111", white: "#fff", ivory: "#f4efe3", cream: "#f3ecd8", beige: "#d9c7a7", sand: "#d8c3a0", tan: "#b58a5a", brown: "#6b4a2e", espresso: "#3a2a20", chocolate: "#4a2f22",
  grey: "#8b8b8b", gray: "#8b8b8b", charcoal: "#3b3b3d", navy: "#1d2c52", blue: "#2f5fb3", sky: "#8fc1e8", teal: "#1f7a7a", green: "#2e7d4f", olive: "#6b6b2d", sage: "#9bb08a",
  mint: "#a8d5c0", red: "#b3262d", maroon: "#6b1d2a", oxblood: "#5a1a22", burgundy: "#6b1d35", pink: "#e59ab0", purple: "#6b3fa0", yellow: "#e6c84a", mustard: "#c99a2e", orange: "#d9772b", gold: "#c9a23c", silver: "#c0c0c0", noir: "#111",
};
export const swatchFor = (name: string): string | null => {
  const key = name.toLowerCase();
  if (SWATCHES[key]) return SWATCHES[key];
  const word = Object.keys(SWATCHES).find((word) => key.split(/[\s/-]+/).includes(word));
  return word ? SWATCHES[word] : null;
};

/** A price box you can finish typing in: what you type is kept as you go and applied when you leave the box or press Enter (an empty box keeps the old price). */
function PriceInput({ value, label, onCommit }: { value: number; label: string; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const apply = () => {
    const digits = (draft ?? "").replace(/\D/g, "");
    if (digits) onCommit(Number(digits));
    setDraft(null);
  };
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
      onBlur={apply}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          apply();
        }
      }}
    />
  );
}

/** Two sliders over one bar: the lower and upper price. Either end can also be typed. */
function PriceRange({ bounds, min, max, onChange }: { bounds: { min: number; max: number }; min?: number; max?: number; onChange: (min?: number, max?: number) => void }) {
  const low = min ?? bounds.min;
  const high = max ?? bounds.max;
  const span = Math.max(1, bounds.max - bounds.min);
  const step = span > 20_000 ? 500 : span > 3_000 ? 100 : 50;
  const commit = (nextLow: number, nextHigh: number) => onChange(nextLow <= bounds.min ? undefined : nextLow, nextHigh >= bounds.max ? undefined : nextHigh);
  const left = ((low - bounds.min) / span) * 100;
  const right = ((high - bounds.min) / span) * 100;
  return (
    <div className="fp-range">
      <div className="fp-track" aria-hidden="true">
        <i style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
      </div>
      <input type="range" aria-label="Lowest price" min={bounds.min} max={bounds.max} step={step} value={low} onChange={(event) => commit(Math.min(Number(event.target.value), high), high)} />
      <input type="range" aria-label="Highest price" min={bounds.min} max={bounds.max} step={step} value={high} onChange={(event) => commit(low, Math.max(Number(event.target.value), low))} />
      <div className="fp-fields">
        <label>
          <span>From</span>
          <PriceInput label="Lowest price in rupees" value={low} onCommit={(next) => commit(Math.min(next, high), high)} />
        </label>
        <b aria-hidden="true">–</b>
        <label>
          <span>To</span>
          <PriceInput label="Highest price in rupees" value={high} onCommit={(next) => commit(low, Math.max(next, low))} />
        </label>
      </div>
      <p className="fp-caption">
        <Price amount={low} /> – <Price amount={high} />
      </p>
    </div>
  );
}

/** The slide-in panel with every filter. Changes apply as they are made; "Show N products" just closes it. */
export function FilterPanel({
  open,
  onClose,
  facets,
  loading,
  filters,
  onChange,
  resultCount,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  facets: Facets | null;
  loading: boolean;
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
  resultCount: number;
  busy: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) setWasOpen(true); // remember it was opened, so the panel can slide closed instead of vanishing

  useModalFocus(open, panel, onClose); // focus moves in, Tab stays in, Escape closes, focus returns to the Filters button

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open && !wasOpen) return null;
  const toggle = (key: "sizes" | "colors", value: string) => {
    const has = filters[key].some((item) => item.toLowerCase() === value.toLowerCase());
    onChange({ ...filters, [key]: has ? filters[key].filter((item) => item.toLowerCase() !== value.toLowerCase()) : [...filters[key], value] });
  };

  return (
    <Portal>
    <div className={`fp-scrim${open ? " is-open" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()} aria-hidden={!open} inert={!open}>
      <div className="fp" role="dialog" aria-modal="true" aria-label="Filter products" tabIndex={-1} ref={panel}>
        <header>
          <h2>Filters{countFilters(filters) ? ` (${countFilters(filters)})` : ""}</h2>
          <button type="button" className="fp-close" onClick={onClose} aria-label="Close filters">✕</button>
        </header>
        <div className="fp-body">
          {loading && !facets && <p className="fp-note">Loading the filters…</p>}
          {facets && facets.price.max > facets.price.min && (
            <section>
              <h3>Price</h3>
              <PriceRange bounds={facets.price} min={filters.min} max={filters.max} onChange={(min, max) => onChange({ ...filters, min, max })} />
            </section>
          )}
          {facets && facets.sizes.length > 0 && (
            <section>
              <h3>Size</h3>
              <div className="fp-chips">
                {facets.sizes.map((size) => {
                  const on = filters.sizes.some((item) => item.toLowerCase() === size.value.toLowerCase());
                  return (
                    <button key={size.value} type="button" aria-pressed={on} className={on ? "on" : ""} onClick={() => toggle("sizes", size.value)}>
                      {size.value}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {facets && facets.colors.length > 0 && (
            <section>
              <h3>Colour</h3>
              <div className="fp-chips">
                {facets.colors.map((color) => {
                  const on = filters.colors.some((item) => item.toLowerCase() === color.value.toLowerCase());
                  const dot = swatchFor(color.value);
                  return (
                    <button key={color.value} type="button" aria-pressed={on} className={on ? "on" : ""} onClick={() => toggle("colors", color.value)}>
                      <i style={{ background: dot ?? "transparent", borderStyle: dot ? "solid" : "dashed" }} aria-hidden="true" />
                      {color.value}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <section>
            <label className="fp-switch">
              <input type="checkbox" checked={filters.inStock} onChange={(event) => onChange({ ...filters, inStock: event.target.checked })} />
              <span>Only show what is in stock</span>
            </label>
          </section>
        </div>
        <footer>
          <button type="button" className="fp-clear" onClick={() => onChange(EMPTY_FILTERS)} disabled={!hasFilters(filters)}>
            Clear all
          </button>
          <button type="button" className="fp-apply" onClick={onClose} aria-busy={busy}>
            {busy ? "Updating…" : `Show ${resultCount} ${resultCount === 1 ? "product" : "products"}`}
          </button>
        </footer>
      </div>
    </div>
    </Portal>
  );
}
