"use client";

import { useEffect, useState } from "react";
import { whatsappMessageLink } from "@/lib/wa-link";

/**
 * International orders are arranged personally on WhatsApp: delivery is by DHL and the freight is quoted for each order, so the checkout
 * (Pakistan only) is not used for them. A shopper whose connection is outside Pakistan sees this prominently; everyone else sees one line.
 */
export function InternationalNotice({ whatsappNumber, message }: { whatsappNumber?: string; message: string }) {
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/geo/country")
      .then((response) => (response.ok ? (response.json() as Promise<{ country: string | null }>) : null))
      .then((body) => {
        if (!cancelled) setCountry(body?.country ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const href = whatsappMessageLink(whatsappNumber, null, message);
  const abroad = country !== null && country !== "PK";
  return abroad ? (
    <aside className="intl-notice is-abroad" aria-label="Ordering from outside Pakistan">
      <p className="intl-notice-title">Ordering from outside Pakistan?</p>
      <p>We arrange international orders personally on WhatsApp. Delivery is by DHL and the freight is quoted for your order before you pay.</p>
      <a className="button button-dark" href={href} target="_blank" rel="noopener noreferrer">
        Continue on WhatsApp
      </a>
    </aside>
  ) : (
    <p className="intl-notice">
      Ordering from outside Pakistan?{" "}
      <a href={href} target="_blank" rel="noopener noreferrer">
        International orders are arranged on WhatsApp
      </a>
      .
    </p>
  );
}
