"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { Hint, useToast } from "../../../_ui/client";
import { Icon } from "../../../_ui/icons";
import { pkr } from "../../../_ui/ui";

type Zone = { id: string; name: string; deliveryCharge: number; estimatedDaysMin: number; estimatedDaysMax: number };
type Variant = { id: string; sku: string; productName: string; variantName: string; price: number; available: number };
type Options = { zones: Zone[]; freeDeliveryThreshold: number; variants: Variant[] };
type Line = { variant: Variant; quantity: number };

const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad Capital Territory", "Gilgit-Baltistan", "Azad Jammu and Kashmir"];

export function NewOrderForm() {
  const router = useRouter();
  const toast = useToast();
  const action = useLockedAction();
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", email: "", city: "", province: "Punjab", address: "", zoneId: "", payment: "cod" as "cod" | "bank_deposit", paid: false, discount: "", notes: "" });
  const [international, setInternational] = useState(false);
  const [quotedDelivery, setQuotedDelivery] = useState("");
  // One key per order form, so a double click or a retry can never create two orders.
  const key = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/orders/place/options", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as Options;
        if (!cancelled) {
          setOptions(data);
          setForm((current) => ({ ...current, zoneId: data.zones[0]?.id ?? "" }));
        }
      })
      .catch(() => !cancelled && setLoadError("Could not load your products. Please refresh the page."));
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!options || term.length < 2) return [];
    return options.variants.filter((variant) => `${variant.productName} ${variant.variantName} ${variant.sku}`.toLowerCase().includes(term)).slice(0, 8);
  }, [options, search]);

  const subtotal = lines.reduce((sum, line) => sum + line.variant.price * line.quantity, 0);
  const zone = options?.zones.find((item) => item.id === form.zoneId);
  const delivery = !zone || subtotal === 0 || (options && subtotal >= options.freeDeliveryThreshold && options.freeDeliveryThreshold > 0) ? 0 : zone.deliveryCharge;
  const discount = Math.min(subtotal, Number(form.discount || 0));
  const total = Math.max(0, subtotal + delivery - discount);

  function add(variant: Variant) {
    setLines((current) => {
      const existing = current.find((line) => line.variant.id === variant.id);
      if (existing) return current.map((line) => (line.variant.id === variant.id ? { ...line, quantity: Math.min(variant.available || 1, line.quantity + 1) } : line));
      return [...current, { variant, quantity: 1 }];
    });
    setSearch("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors([]);
    if (!lines.length) {
      setErrors(["Please add at least one product."]);
      return;
    }
    await action.run(async () => {
      const response = await fetch("/api/admin/orders/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: (key.current ??= crypto.randomUUID()),
          autoBook: true,
          order: {
            customerName: form.name,
            customerPhone: form.phone,
            customerEmail: form.email || undefined,
            city: form.city,
            province: form.province,
            address: form.address,
            zoneId: international ? undefined : form.zoneId || undefined,
            ...(international ? { international: true, deliveryCharge: Number(quotedDelivery || 0) } : {}),
            paymentMethod: form.payment,
            paymentStatus: form.payment === "bank_deposit" && form.paid ? "paid" : "pending",
            discount: discount || undefined,
            notes: form.notes || undefined,
            items: lines.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })),
          },
        }),
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { order?: { orderId: string; orderNumber: string }; errors?: string[]; courierNotice?: { tone: "good" | "bad" | "info"; text: string } | null } | null;
      if (!response || !response.ok || !data?.order) {
        setErrors(data?.errors?.length ? data.errors : ["Could not place the order. Please check your internet and try again."]);
        return;
      }
      toast(`Order ${data.order.orderNumber} placed.`, "good");
      if (data.courierNotice) toast(data.courierNotice.text, data.courierNotice.tone);
      router.push(`/admin/orders/${data.order.orderId}`);
    });
  }

  if (loadError) return <p className="a-error">{loadError}</p>;
  if (!options) return <p className="a-muted"><span className="spinner" aria-hidden="true" /> Loading…</p>;

  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [name]: event.target.value }));

  return (
    <form onSubmit={submit} className="a-split">
      <div className="a-stack">
        <section className="a-card">
          <header className="a-card-head"><h2>1. Who is it for?</h2></header>
          <div className="a-card-pad a-form-grid">
            <label className="a-check wide">
              <input type="checkbox" checked={international} onChange={(event) => setInternational(event.target.checked)} />
              <span><strong>This customer is outside Pakistan.</strong> You ship it yourself; it is never booked through TCS automatically. Write the country in the address.</span>
            </label>
            {international && (
              <div className="a-field wide">
                <label htmlFor="no-intl-delivery">Delivery charge you quoted (PKR)</label>
                <input id="no-intl-delivery" value={quotedDelivery} onChange={(event) => setQuotedDelivery(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="0" />
              </div>
            )}
            <div className="a-field">
              <label htmlFor="no-name">Customer name</label>
              <input id="no-name" value={form.name} onChange={set("name")} required autoComplete="off" />
            </div>
            <div className="a-field">
              <label htmlFor="no-phone">Mobile number</label>
              <input id="no-phone" value={form.phone} onChange={set("phone")} required inputMode="tel" placeholder="03001234567" autoComplete="off" />
            </div>
            <div className="a-field">
              <label htmlFor="no-city">City</label>
              <input id="no-city" value={form.city} onChange={set("city")} required list="no-cities" autoComplete="off" />
              <datalist id="no-cities">
                {["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan", "Peshawar", "Quetta", "Hyderabad", "Sialkot", "Gujranwala"].map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
            </div>
            <div className="a-field">
              <label htmlFor="no-province">Province</label>
              <select id="no-province" value={form.province} onChange={set("province")}>
                {PROVINCES.map((province) => (
                  <option key={province}>{province}</option>
                ))}
              </select>
            </div>
            <div className="a-field wide">
              <label htmlFor="no-address">Full address</label>
              <textarea id="no-address" value={form.address} onChange={set("address")} required rows={2} placeholder="House / flat number, street, area" />
            </div>
          </div>
        </section>

        <section className="a-card">
          <header className="a-card-head"><h2>2. What did they order?</h2></header>
          <div className="a-card-pad a-stack" style={{ gap: 14 }}>
            <div className="a-field" style={{ position: "relative" }}>
              <label htmlFor="no-search">Search for a product or size</label>
              <input id="no-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type a name, e.g. “kameez” or a code" autoComplete="off" />
              {matches.length > 0 && (
                <ul className="a-card" style={{ listStyle: "none", margin: 0, padding: 6, position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, marginTop: 4 }}>
                  {matches.map((variant) => (
                    <li key={variant.id}>
                      <button type="button" className="a-btn a-btn-quiet" style={{ width: "100%", justifyContent: "space-between", height: "auto", padding: "9px 12px" }} disabled={variant.available < 1} onClick={() => add(variant)}>
                        <span style={{ textAlign: "left" }}>
                          <strong>{variant.productName}</strong> <span className="a-muted">· {variant.variantName}</span>
                        </span>
                        <span className="a-muted">{variant.available < 1 ? "Sold out" : `${variant.available} in stock · ${pkr(variant.price)}`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {search.trim().length >= 2 && !matches.length && <span className="a-help">Nothing found. Check the spelling, or add the product first.</span>}
            </div>
            {lines.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {lines.map((line) => (
                  <li key={line.variant.id} className="a-row" style={{ padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10 }}>
                    <span style={{ flex: 1, minWidth: 180 }}>
                      <strong>{line.variant.productName}</strong>
                      <small className="a-muted" style={{ display: "block" }}>
                        {line.variant.variantName} · {pkr(line.variant.price)} each · {line.variant.available} in stock
                      </small>
                    </span>
                    <div className="a-row" style={{ gap: 4 }}>
                      <button type="button" className="a-btn a-btn-sm" aria-label="One less" onClick={() => setLines((c) => c.map((l) => (l === line ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l)))}>−</button>
                      <strong style={{ minWidth: 28, textAlign: "center" }}>{line.quantity}</strong>
                      <button type="button" className="a-btn a-btn-sm" aria-label="One more" disabled={line.quantity >= line.variant.available} onClick={() => setLines((c) => c.map((l) => (l === line ? { ...l, quantity: l.quantity + 1 } : l)))}>+</button>
                    </div>
                    <strong className="a-money" style={{ minWidth: 100, textAlign: "right" }}>{pkr(line.variant.price * line.quantity)}</strong>
                    <button type="button" className="a-icon-btn" aria-label={`Remove ${line.variant.productName}`} onClick={() => setLines((c) => c.filter((l) => l !== line))}>
                      <Icon name="x" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="a-muted">No products added yet.</p>
            )}
          </div>
        </section>

        <section className="a-card">
          <header className="a-card-head"><h2>3. Delivery and payment</h2></header>
          <div className="a-card-pad a-form-grid">
            <div className="a-field">
              <label htmlFor="no-zone">
                Delivery area <Hint text="Decides the delivery charge. Orders above the free-delivery amount ship free." />
              </label>
              <select id="no-zone" value={form.zoneId} onChange={set("zoneId")} required>
                {options.zones.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {pkr(item.deliveryCharge)}
                  </option>
                ))}
              </select>
            </div>
            <div className="a-field">
              <label htmlFor="no-pay">How will they pay?</label>
              <select id="no-pay" value={form.payment} onChange={set("payment")}>
                <option value="cod">Cash on delivery (they pay the TCS rider)</option>
                <option value="bank_deposit">Bank transfer</option>
              </select>
            </div>
            {form.payment === "bank_deposit" && (
              <label className="a-check wide">
                <input type="checkbox" checked={form.paid} onChange={(event) => setForm((c) => ({ ...c, paid: event.target.checked }))} />
                <span>The money has already reached my account</span>
              </label>
            )}
            <div className="a-field">
              <label htmlFor="no-discount">Discount (PKR, optional)</label>
              <input id="no-discount" value={form.discount} onChange={(event) => setForm((c) => ({ ...c, discount: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="0" />
            </div>
            <div className="a-field">
              <label htmlFor="no-email">Email (optional)</label>
              <input id="no-email" type="email" value={form.email} onChange={set("email")} />
            </div>
            <div className="a-field wide">
              <label htmlFor="no-notes">Note (optional)</label>
              <input id="no-notes" value={form.notes} onChange={set("notes")} placeholder="Anything to remember about this order" />
            </div>
          </div>
        </section>
      </div>

      <aside style={{ position: "sticky", top: 84 }} className="a-stack">
        <section className="a-card a-card-pad a-stack" style={{ gap: 10 }}>
          <h2 style={{ fontSize: 18 }}>Summary</h2>
          <div className="a-row" style={{ justifyContent: "space-between" }}><span className="a-muted">Items</span><span className="a-money">{pkr(subtotal)}</span></div>
          <div className="a-row" style={{ justifyContent: "space-between" }}><span className="a-muted">Delivery</span><span className="a-money">{delivery ? pkr(delivery) : "Free"}</span></div>
          {discount > 0 && <div className="a-row" style={{ justifyContent: "space-between" }}><span className="a-muted">Discount</span><span className="a-money">− {pkr(discount)}</span></div>}
          <div className="a-row" style={{ justifyContent: "space-between", fontSize: 20, fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 10 }}><span>Total</span><span className="a-money">{pkr(total)}</span></div>
          {errors.length > 0 && (
            <ul role="alert" className="a-error" style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <button className="a-btn a-btn-primary a-btn-lg" disabled={action.pending} aria-busy={action.pending}>
            {action.pending ? (
              <span className="busy-label">
                <span className="spinner spinner-light" aria-hidden="true" /> Placing order…
              </span>
            ) : (
              "Place order"
            )}
          </button>
          <p className="a-help">The stock is held for this customer straight away.</p>
        </section>
      </aside>
    </form>
  );
}
