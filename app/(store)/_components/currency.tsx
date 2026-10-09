"use client";

import { HIDE_KEYS, hideFor, useWidgetHidden } from "./floating-widgets";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_CURRENCY,
  CURRENCIES,
  currencyForCountry,
  flagSrc,
  formatPrice,
  isCurrencyCode,
  type CurrencyCode,
  type RatesPayload,
  type RatesPerPkr,
} from "@/lib/currency";

const CURRENCY_KEY = "na-currency";
const RATES_KEY = "na-rates";
const AUTO_KEY = "na-currency-auto";
const RATES_TTL_MS = 6 * 60 * 60 * 1000;

type CurrencyContextValue = {
  currency: CurrencyCode;
  setCurrency: (code: CurrencyCode) => void;
  rates: RatesPerPkr | null;
  format: (amountPkr: number) => string;
};

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: BASE_CURRENCY,
  setCurrency: () => {},
  rates: null,
  format: (amount) => formatPrice(amount, BASE_CURRENCY, null),
});

function readStored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / blocked storage — the switcher still works for the current page view.
  }
}

/** Provides the saved or country-based currency choice and cached exchange rates, retrying failed rate requests. */
export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  // Always start on PKR so server and client markup match; the saved choice is applied after mount.
  const [currency, setCurrencyState] = useState<CurrencyCode>(BASE_CURRENCY);
  const [rates, setRates] = useState<RatesPerPkr | null>(null);
  const requested = useRef(false);
  const [rateRetry, setRateRetry] = useState(0);
  const retryTimer = useRef(0);

  useEffect(() => {
    const saved = readStored<string>(CURRENCY_KEY);
    // localStorage is only readable after mount (SSR renders PKR), so this one-time sync is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isCurrencyCode(saved)) setCurrencyState(saved);
  }, []);

  // First visit and no choice yet: start on the currency of the shopper's own country (once; their own choice always wins afterwards).
  useEffect(() => {
    if (readStored<string>(CURRENCY_KEY) || readStored<boolean>(AUTO_KEY)) return;
    let cancelled = false;
    fetch("/api/geo/country")
      .then((response) => (response.ok ? (response.json() as Promise<{ country: string | null }>) : null))
      .then((data) => {
        if (cancelled || !data) return; // a failed lookup leaves the marker unset, so the next visit tries again
        writeStored(AUTO_KEY, true); // an answer arrived (even "unknown"): never ask again
        if (!data.country || readStored<string>(CURRENCY_KEY)) return;
        const guess = currencyForCountry(data.country);
        if (guess !== BASE_CURRENCY) {
          setCurrencyState(guess);
          writeStored(CURRENCY_KEY, guess); // remembered, so a reload keeps it; the shopper's own choice replaces it any time
        }
      })
      .catch(() => {
        // no country: stay on PKR and try again on the next visit
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currency === BASE_CURRENCY || requested.current) return;
    requested.current = true;
    const cached = readStored<RatesPayload>(RATES_KEY);
    if (cached && Date.now() - cached.fetchedAt < RATES_TTL_MS) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRates(cached.rates);
      return;
    }
    fetch("/api/currency")
      .then((response) => (response.ok ? (response.json() as Promise<RatesPayload>) : null))
      .then((payload) => {
        if (!payload?.rates) {
          // 503 / bad body: try again shortly (a few times), so the switcher does not say "Loading rates…" for the rest of the visit.
          requested.current = false;
          if (rateRetry < 3) retryTimer.current = window.setTimeout(() => setRateRetry((count) => count + 1), 15_000);
          return;
        }
        setRates(payload.rates);
        writeStored(RATES_KEY, payload);
      })
      .catch(() => {
        // Prices simply stay in PKR if rates can't be loaded.
        requested.current = false;
        if (rateRetry < 3) retryTimer.current = window.setTimeout(() => setRateRetry((count) => count + 1), 15_000);
      });
    // a pending retry is cancelled when the shopper changes currency or the page goes away (no second request, no update after unmount)
    return () => window.clearTimeout(retryTimer.current);
  }, [currency, rateRetry]);

  const setCurrency = useCallback((code: CurrencyCode) => {
    setCurrencyState(code);
    writeStored(CURRENCY_KEY, code);
  }, []);

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency, setCurrency, rates, format: (amount) => formatPrice(amount, currency, rates) }),
    [currency, rates, setCurrency],
  );
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return useContext(CurrencyContext);
}

/** A price in the shopper's chosen currency. `amount` is always PKR, as stored in the database. */
export function Price({ amount, className }: { amount: number; className?: string }) {
  const { format } = useCurrency();
  return <span className={className}>{format(amount)}</span>;
}

export function CurrencySwitcher() {
  const { currency, setCurrency, rates } = useCurrency();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [hidden] = useWidgetHidden(HIDE_KEYS.currency);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (hidden) return null;
  return (
    <div className="currency-switcher" ref={ref}>
      <div className="currency-bar">
        <button type="button" className="currency-main" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={flagSrc(currency)} width={20} height={15} alt="" />
          {currency} <span aria-hidden="true">▾</span>
        </button>
        <button type="button" className="currency-close" aria-label="Hide the currency selector" title="Hide" onClick={() => { setOpen(false); hideFor(HIDE_KEYS.currency); }}>
          ✕
        </button>
      </div>
      {open && (
        <ul role="listbox" aria-label="Currency">
          {CURRENCIES.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                role="option"
                aria-selected={item.code === currency}
                className={item.code === currency ? "active" : ""}
                onClick={() => {
                  setCurrency(item.code);
                  setOpen(false);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={flagSrc(item.code)} width={20} height={15} alt="" loading="lazy" />
                <b>{item.code}</b>
                <span>{item.name}</span>
              </button>
            </li>
          ))}
          {currency !== BASE_CURRENCY && !rates && <li className="currency-note">Loading rates…</li>}
          {currency !== BASE_CURRENCY && rates && (
            <li className="currency-note">Approximate. Orders are charged in PKR.</li>
          )}
        </ul>
      )}
    </div>
  );
}
