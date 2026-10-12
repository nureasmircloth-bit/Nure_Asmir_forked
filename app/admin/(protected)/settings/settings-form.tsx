"use client";

import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { useLockedAction } from "@/lib/use-locked-action";
import { AnnouncementBar } from "@/components/announcement-bar";
import { callApi, Dialog, Hint, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { Badge } from "../../_ui/ui";
import { buildAnnouncements, isAnnouncementMode, isAnnouncementStyle, isDeliveryMode } from "@/lib/shop-rules";
import { PhotoShrinker } from "./photo-shrinker";

export type SettingsValues = {
  brandName: string;
  supportPhone: string;
  whatsappNumber: string;
  whatsappChatUrl: string;
  supportEmail: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  tcsShipperName: string;
  tcsShipperAddress: string;
  tcsShipperCityName: string;
  tcsShipperCityCode: string;
  tcsShipperPhone: string;
  bankName: string;
  bankAccountTitle: string;
  bankAccountNumber: string;
  bankIban: string;
  freeDeliveryThreshold: number;
  codReservationHours: number;
  bankReservationHours: number;
  refundWindowDays: number;
  soldoutHideDays: number;
  announcementMode: string;
  announcementLines: string;
  announcementStyle: string;
  bankDepositEnabled: boolean;
  deliveryMode: string;
  flatDeliveryCharge: number;
  googleSiteVerification: string;
  bingSiteVerification: string;
  metaPixelId: string;
  gaMeasurementId: string;
  themeAccentColor: string;
  themePreset: string;
  themeBackgroundColor: string;
  themeTextColor: string;
  themeSurfaceColor: string;
  themeRadius: string;
  fontFamily: string;
  bodyFontFamily: string;
  contactFontFamily: string;
};
export type PendingSettings = {
  changes: Partial<SettingsValues>;
  applyAt: string;
  remainingSeconds: number;
};

export type SystemStatus = { tcs: boolean; tcsLive: boolean; push: boolean; search: boolean; email: boolean; whatsapp: boolean; writer: boolean; spamShield: boolean };

const CITY_CODES: Array<[string, string]> = [["Karachi", "KHI"], ["Lahore", "LHE"], ["Islamabad", "ISB"], ["Rawalpindi", "RWP"], ["Faisalabad", "LYP"], ["Multan", "MUX"], ["Peshawar", "PEW"], ["Quetta", "UET"], ["Hyderabad", "HDD"], ["Sialkot", "SKT"], ["Gujranwala", "GRW"]];

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="a-card" id={id} style={{ scrollMarginTop: 84 }}>
      <header className="a-card-head">
        <div>
          <h2>{title}</h2>
          {intro && <small>{intro}</small>}
        </div>
      </header>
      <div className="a-card-pad a-form-grid">{children}</div>
    </section>
  );
}

function formatSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SettingsForm({ initial, status, initialPending }: { initial: SettingsValues; status: SystemStatus; initialPending?: PendingSettings | null }) {
  const router = useRouter();
  const toast = useToast();
  const saving = useLockedAction();
  const testing = useLockedAction();
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<PendingSettings | null>(initialPending ?? null);
  const [countdown, setCountdown] = useState<number>(initialPending?.remainingSeconds ?? 0);

  useEffect(() => {
    if (!pending || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setPending(null);
          toast("Buffered settings changes have taken effect on your live storefront.", "good");
          router.refresh();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pending, countdown, router, toast]);

  const set = (key: keyof SettingsValues) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: typeof initial[key] === "number" ? Number(event.target.value.replace(/\D/g, "")) : event.target.value }));
    setDirty(true);
  };
  const setValue = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const choice = (key: "announcementMode" | "announcementStyle" | "deliveryMode", value: string, title: string, detail: string) => (
    <label className="a-check" key={value}>
      <input type="radio" name={`s-${key}`} checked={form[key] === value} onChange={() => setValue(key, value)} />
      <span>
        <strong>{title}</strong>
        <small className="a-help" style={{ display: "block" }}>{detail}</small>
      </span>
    </label>
  );
  const topBarPreview = buildAnnouncements({
    mode: isAnnouncementMode(form.announcementMode) ? form.announcementMode : "auto",
    lines: form.announcementLines,
    freeDeliveryAbove: form.freeDeliveryThreshold,
    bankDepositEnabled: form.bankDepositEnabled,
  });
  const text = (key: keyof SettingsValues, label: string, options: { hint?: string; placeholder?: string; wide?: boolean; type?: string; help?: string; prefix?: string } = {}) => (
    <div className={`a-field${options.wide ? " wide" : ""}`}>
      <label htmlFor={`s-${key}`}>
        {label} {options.hint && <Hint text={options.hint} />}
      </label>
      <input id={`s-${key}`} type={options.type ?? "text"} value={String(form[key])} onChange={set(key)} placeholder={options.placeholder} inputMode={typeof initial[key] === "number" ? "numeric" : undefined} />
      {options.help && <span className="a-help">{options.help}</span>}
    </div>
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!isDeliveryMode(form.deliveryMode) || !isAnnouncementMode(form.announcementMode)) {
      toast("Please choose one of the options.", "bad");
      return;
    }
    await saving.run(async () => {
      const result = await callApi<{ settings: Partial<Record<keyof SettingsValues, string | number>>; pending?: PendingSettings }>("/api/admin/settings", "PATCH", form);
      if (result.ok) {
        if (result.data.pending) {
          setPending(result.data.pending);
          setCountdown(result.data.pending.remainingSeconds || 300);
          toast("Settings saved with a 5-minute safety buffer. You can revert at any time before it applies.", "good");
        } else {
          const saved = result.data.settings ?? {};
          setForm((current) => ({ ...current, ...Object.fromEntries((Object.keys(current) as Array<keyof SettingsValues>).filter((key) => saved[key] !== undefined).map((key) => [key, saved[key]])) }));
          toast("Settings saved. Your website is updating.", "good");
        }
        setDirty(false);
        router.refresh();
      } else toast(result.error, "bad");
    });
  }

  async function revertChanges() {
    await saving.run(async () => {
      const result = await callApi<{ settings: Partial<Record<keyof SettingsValues, string | number>> }>("/api/admin/settings", "PATCH", { action: "revert" });
      if (result.ok) {
        setPending(null);
        setCountdown(0);
        if (result.data.settings) {
          const saved = result.data.settings;
          setForm((current) => ({
            ...current,
            ...Object.fromEntries((Object.keys(current) as Array<keyof SettingsValues>).filter((key) => saved[key] !== undefined).map((key) => [key, saved[key]])),
          }));
        }
        toast("Pending settings changes reverted.", "good");
        setDirty(false);
        router.refresh();
      } else {
        toast(result.error || "Could not revert changes.", "bad");
      }
    });
  }

  async function applyImmediately() {
    await saving.run(async () => {
      const result = await callApi<{ settings: Partial<Record<keyof SettingsValues, string | number>> }>("/api/admin/settings", "PATCH", { action: "apply-now" });
      if (result.ok) {
        setPending(null);
        setCountdown(0);
        if (result.data.settings) {
          const saved = result.data.settings;
          setForm((current) => ({
            ...current,
            ...Object.fromEntries((Object.keys(current) as Array<keyof SettingsValues>).filter((key) => saved[key] !== undefined).map((key) => [key, saved[key]])),
          }));
        }
        toast("Settings applied immediately to the live website.", "good");
        setDirty(false);
        router.refresh();
      } else {
        toast(result.error || "Could not apply settings.", "bad");
      }
    });
  }

  const statusRow = (ok: boolean, label: string, good: string, bad: string) => (
    <li className="a-row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <span>{label}</span>
      <span className="a-row">
        <span className="a-muted">{ok ? good : bad}</span>
        <Badge tone={ok ? "done" : "new"}>{ok ? "Working" : "Not set up"}</Badge>
      </span>
    </li>
  );

  return (
    <form onSubmit={save} className="a-stack">
      {pending && (
        <aside
          className="a-card"
          role="status"
          aria-live="polite"
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
            border: "1.5px solid #f59e0b",
            borderRadius: 14,
            boxShadow: "0 4px 16px rgba(245, 158, 11, 0.12)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#fef3c7", border: "1px solid #fde68a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                ⏳
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ color: "#92400e", fontSize: 15 }}>5-Minute Safety Buffer Active</strong>
                  <span style={{ background: "#b45309", color: "#fff", fontWeight: 700, fontSize: 12, padding: "2px 8px", borderRadius: 6, fontVariantNumeric: "tabular-nums" }}>
                    {formatSeconds(countdown)}
                  </span>
                </div>
                <p style={{ margin: "3px 0 0", color: "#78350f", fontSize: 13 }}>
                  Your changes are buffered. They will automatically apply to the live storefront in <strong>{formatSeconds(countdown)}</strong> unless reverted.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="a-btn a-btn-sm"
                style={{ background: "#dc2626", color: "#fff", borderColor: "#b91c1c", fontWeight: 600 }}
                onClick={revertChanges}
                disabled={saving.pending}
                title="Cancel and restore previous settings"
              >
                <Icon name="x" size={14} /> Revert changes
              </button>
              <button
                type="button"
                className="a-btn a-btn-sm a-btn-primary"
                style={{ fontWeight: 600 }}
                onClick={applyImmediately}
                disabled={saving.pending}
                title="Skip buffer and apply now to live website"
              >
                <Icon name="check" size={14} /> Apply immediately
              </button>
            </div>
          </div>
        </aside>
      )}
      <section className="a-card">
        <header className="a-card-head">
          <h2>Is everything connected?</h2>
        </header>
        <ul style={{ listStyle: "none", margin: 0, padding: "4px 22px 12px" }}>
          {statusRow(status.tcs, "TCS (booking parcels)", status.tcsLive ? "Live" : "Test mode", "You can still type tracking numbers by hand")}
          {statusRow(status.push, "Order alerts on your computer", "Ready", "Needs setup")}
          {statusRow(status.search, "Website search", "Ready", "Basic search is used")}
          {statusRow(status.email, "Emails to customers", "Ready", "No emails are sent")}
          {statusRow(status.whatsapp, "WhatsApp order confirmation", "Ready", "Not connected — you can still WhatsApp customers yourself")}
          {statusRow(status.writer, "“Write it for me” helper", "Ready", "Not set up")}
          {statusRow(status.spamShield, "Protection against fake orders", "Ready", "Not set up")}
        </ul>
      </section>

      <Section id="contact" title="Your shop and how customers reach you" intro="These appear in the footer, on the Contact page and in emails.">
        {text("brandName", "Shop name")}
        {text("supportPhone", "Phone number (Direct calling)", { placeholder: "+92 42 36622241", hint: "Official support phone shown on Contact page and footer. (Default: +92 42 36622241)" })}
        {text("whatsappNumber", "WhatsApp number", { hint: "The number for the green WhatsApp button on your website.", placeholder: "+92 311 6111963" })}
        {text("whatsappChatUrl", "WhatsApp chat link (optional)", { hint: "A link that opens a chat with you, like wa.me/message/… from WhatsApp Business. If empty, we use your WhatsApp number.", placeholder: "https://wa.me/message/…" })}
        {text("supportEmail", "Email address", { type: "email", placeholder: "hello@nureasmir.com" })}
        {text("instagramUrl", "Instagram page", { placeholder: "https://www.instagram.com/yourname" })}
        {text("facebookUrl", "Facebook page", { placeholder: "https://www.facebook.com/yourpage" })}
        {text("tiktokUrl", "TikTok page", { placeholder: "https://www.tiktok.com/@yourname" })}
      </Section>

      <Section id="appearance" title="Storefront theme & appearance" intro="Customize your whole website aesthetic — background, surfaces, typography, colors and corner radius. Updates apply globally across the storefront.">
        <div className="a-field wide">
          <label>
            Curated brand theme presets <Hint text="Select a signature luxury theme to instantly harmonize backgrounds, card surfaces, text contrast, accents, and typography." />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginTop: 8 }}>
            {[
              {
                id: "signature",
                name: "Signature Ivory & Gold",
                desc: "Classic luxury — pure white canvas, dark ink, warm champagne gold.",
                bg: "#ffffff",
                surface: "#faf9f6",
                text: "#111111",
                accent: "#c5a059",
                radius: "subtle",
                displayFont: "Cormorant Garamond",
                bodyFont: "Jost",
              },
              {
                id: "cashmere",
                name: "Warm Cashmere & Bronze",
                desc: "Warm linen tones, rich bronze highlights, editorial typography.",
                bg: "#fbf8f5",
                surface: "#f3ece3",
                text: "#231d19",
                accent: "#9d7a54",
                radius: "subtle",
                displayFont: "Playfair Display",
                bodyFont: "Jost",
              },
              {
                id: "emerald",
                name: "Emerald Heritage",
                desc: "Regal forest green accent on porcelain white with Roman serif headings.",
                bg: "#f6f8f7",
                surface: "#ebf2ee",
                text: "#122019",
                accent: "#1b4332",
                radius: "subtle",
                displayFont: "Cinzel",
                bodyFont: "Outfit",
              },
              {
                id: "noir",
                name: "Midnight Noir",
                desc: "High-contrast dark luxury runway mode with sharp corners and gold.",
                bg: "#101012",
                surface: "#1a1a1e",
                text: "#f4f4f6",
                accent: "#d4af37",
                radius: "sharp",
                displayFont: "Playfair Display",
                bodyFont: "Inter",
              },
              {
                id: "minimal",
                name: "Modern Minimal",
                desc: "Clean monochrome gallery aesthetic with rounded soft geometry.",
                bg: "#ffffff",
                surface: "#f4f4f5",
                text: "#18181b",
                accent: "#18181b",
                radius: "rounded",
                displayFont: "Outfit",
                bodyFont: "Inter",
              },
              {
                id: "navy",
                name: "Royal Navy & Champagne",
                desc: "Deep navy undertones with metallic gold buttons and modern sans.",
                bg: "#f7f9fc",
                surface: "#edf2f7",
                text: "#0f172a",
                accent: "#c29a59",
                radius: "subtle",
                displayFont: "Prata",
                bodyFont: "Plus Jakarta Sans",
              },
            ].map((p) => {
              const isSelected = form.themePreset === p.id || (
                form.themeBackgroundColor?.toLowerCase() === p.bg.toLowerCase() &&
                form.themeAccentColor?.toLowerCase() === p.accent.toLowerCase() &&
                form.themeTextColor?.toLowerCase() === p.text.toLowerCase()
              );
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setValue("themePreset", p.id);
                    setValue("themeBackgroundColor", p.bg);
                    setValue("themeSurfaceColor", p.surface);
                    setValue("themeTextColor", p.text);
                    setValue("themeAccentColor", p.accent);
                    setValue("themeRadius", p.radius);
                    setValue("fontFamily", p.displayFont);
                    setValue("bodyFontFamily", p.bodyFont);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: isSelected ? "2px solid var(--ink)" : "1px solid var(--line)",
                    background: isSelected ? "var(--sunk)" : "var(--bg)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    transition: "all .15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 500, color: "var(--ink)" }}>{p.name}</span>
                    <div style={{ display: "flex", gap: 3 }}>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.bg, border: "1px solid #ccc" }} title="Background" />
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.surface, border: "1px solid #ccc" }} title="Surface" />
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.text, border: "1px solid #ccc" }} title="Text" />
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.accent, border: "1px solid #ccc" }} title="Accent" />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--ink-light)", lineHeight: 1.4 }}>{p.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="a-field">
          <label htmlFor="s-themeBackgroundColor">
            Website background colour <Hint text="The main backdrop colour of your entire storefront." />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <input
              type="color"
              value={form.themeBackgroundColor?.startsWith("#") ? form.themeBackgroundColor : "#ffffff"}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeBackgroundColor", e.target.value);
              }}
              style={{ width: 38, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8, cursor: "pointer", background: "transparent" }}
            />
            <input
              id="s-themeBackgroundColor"
              type="text"
              value={form.themeBackgroundColor}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeBackgroundColor", e.target.value);
              }}
              placeholder="#ffffff"
              style={{ width: 110, fontSize: 13, textTransform: "lowercase", fontFamily: "monospace" }}
            />
          </div>
        </div>

        <div className="a-field">
          <label htmlFor="s-themeSurfaceColor">
            Card & surface colour <Hint text="Used for cards, drawer panels, filter dropdowns and soft pill backgrounds." />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <input
              type="color"
              value={form.themeSurfaceColor?.startsWith("#") ? form.themeSurfaceColor : "#faf9f6"}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeSurfaceColor", e.target.value);
              }}
              style={{ width: 38, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8, cursor: "pointer", background: "transparent" }}
            />
            <input
              id="s-themeSurfaceColor"
              type="text"
              value={form.themeSurfaceColor}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeSurfaceColor", e.target.value);
              }}
              placeholder="#faf9f6"
              style={{ width: 110, fontSize: 13, textTransform: "lowercase", fontFamily: "monospace" }}
            />
          </div>
        </div>

        <div className="a-field">
          <label htmlFor="s-themeTextColor">
            Primary text / ink colour <Hint text="The main text colour used for headings, product titles, prices and body copy." />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <input
              type="color"
              value={form.themeTextColor?.startsWith("#") ? form.themeTextColor : "#111111"}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeTextColor", e.target.value);
              }}
              style={{ width: 38, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8, cursor: "pointer", background: "transparent" }}
            />
            <input
              id="s-themeTextColor"
              type="text"
              value={form.themeTextColor}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeTextColor", e.target.value);
              }}
              placeholder="#111111"
              style={{ width: 110, fontSize: 13, textTransform: "lowercase", fontFamily: "monospace" }}
            />
          </div>
        </div>

        <div className="a-field">
          <label htmlFor="s-themeAccentColor">
            Theme accent colour <Hint text="Signature highlight colour used for checkout buttons, badges, sale tags and active tabs." />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <input
              type="color"
              value={form.themeAccentColor?.startsWith("#") ? form.themeAccentColor : "#c5a059"}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeAccentColor", e.target.value);
              }}
              style={{ width: 38, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8, cursor: "pointer", background: "transparent" }}
            />
            <input
              id="s-themeAccentColor"
              type="text"
              value={form.themeAccentColor}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("themeAccentColor", e.target.value);
              }}
              placeholder="#c5a059"
              style={{ width: 110, fontSize: 13, textTransform: "lowercase", fontFamily: "monospace" }}
            />
          </div>
        </div>

        <div className="a-field">
          <label htmlFor="s-themeRadius">
            Corner radius style <Hint text="Sets the curvature of buttons, cards, search bars and interactive elements." />
          </label>
          <select
            id="s-themeRadius"
            value={form.themeRadius || "subtle"}
            onChange={(e) => {
              setValue("themePreset", "custom");
              setValue("themeRadius", e.target.value);
            }}
          >
            <option value="sharp">Sharp (0px — Architectural runway luxury)</option>
            <option value="subtle">Subtle (4px — Classic bespoke tailoring / Default)</option>
            <option value="rounded">Rounded (10px — Soft modern luxury)</option>
            <option value="pill">Pill (20px — Contemporary friendly)</option>
          </select>
        </div>

        <div className="a-field">
          <label htmlFor="s-fontFamily">
            Brand display font (Headings) <Hint text="Used for large brand titles, category headings and luxury quotes." />
          </label>
          <select
            id="s-fontFamily"
            value={["Cormorant Garamond", "Playfair Display", "Inter", "Outfit", "Plus Jakarta Sans", "Montserrat", "Cinzel", "Prata"].includes(form.fontFamily) ? form.fontFamily : "custom"}
            onChange={(e) => {
              if (e.target.value !== "custom") {
                setValue("themePreset", "custom");
                setValue("fontFamily", e.target.value);
              }
            }}
          >
            <option value="Cormorant Garamond">Cormorant Garamond (Classic Luxury Serif — Default)</option>
            <option value="Playfair Display">Playfair Display (High-Fashion Editorial)</option>
            <option value="Cinzel">Cinzel (Royal Roman Serif)</option>
            <option value="Prata">Prata (Refined Didone Serif)</option>
            <option value="Inter">Inter (Ultra-Clean Modern Sans)</option>
            <option value="Outfit">Outfit (Minimalist Geometric Sans)</option>
            <option value="Plus Jakarta Sans">Plus Jakarta Sans (Contemporary Premium Sans)</option>
            <option value="Montserrat">Montserrat (Clean Architectural Sans)</option>
            <option value="custom">Custom Google Font…</option>
          </select>
          {!["Cormorant Garamond", "Playfair Display", "Inter", "Outfit", "Plus Jakarta Sans", "Montserrat", "Cinzel", "Prata"].includes(form.fontFamily) && (
            <input
              type="text"
              value={form.fontFamily}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("fontFamily", e.target.value);
              }}
              placeholder="e.g. Bodoni Moda, Lora, Marcellus"
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div className="a-field">
          <label htmlFor="s-bodyFontFamily">
            Brand body font (Paragraphs & UI) <Hint text="Used for product descriptions, navigation links, filters, and checkout." />
          </label>
          <select
            id="s-bodyFontFamily"
            value={["Jost", "Inter", "Outfit", "Plus Jakarta Sans", "Montserrat", "Lato", "system-ui"].includes(form.bodyFontFamily) ? form.bodyFontFamily : "custom"}
            onChange={(e) => {
              if (e.target.value !== "custom") {
                setValue("themePreset", "custom");
                setValue("bodyFontFamily", e.target.value);
              }
            }}
          >
            <option value="Jost">Jost (Clean geometric sans — Default)</option>
            <option value="Inter">Inter (Crisp modern UI sans)</option>
            <option value="Outfit">Outfit (Contemporary minimalist)</option>
            <option value="Plus Jakarta Sans">Plus Jakarta Sans (Warm executive sans)</option>
            <option value="Montserrat">Montserrat (Editorial sans)</option>
            <option value="Lato">Lato (Classic neutral sans)</option>
            <option value="system-ui">System native (Fastest, OS default)</option>
            <option value="custom">Custom Google Font…</option>
          </select>
          {!["Jost", "Inter", "Outfit", "Plus Jakarta Sans", "Montserrat", "Lato", "system-ui"].includes(form.bodyFontFamily) && (
            <input
              type="text"
              value={form.bodyFontFamily}
              onChange={(e) => {
                setValue("themePreset", "custom");
                setValue("bodyFontFamily", e.target.value);
              }}
              placeholder="e.g. Raleway, Poppins, Nunito Sans"
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div className="a-field">
          <label htmlFor="s-contactFontFamily">
            Contact page font <Hint text="Typography used for customer care information and contact details." />
          </label>
          <select
            id="s-contactFontFamily"
            value={form.contactFontFamily}
            onChange={(e) => setValue("contactFontFamily", e.target.value)}
          >
            <option value="Inter">Inter (Simple & ultra-crisp sans-serif — Recommended)</option>
            <option value="Outfit">Outfit (Clean, modern geometry)</option>
            <option value="system-ui">System native (Fastest, matches device font)</option>
            <option value="Cormorant Garamond">Cormorant Garamond (Match luxury serif)</option>
          </select>
        </div>

        <div className="wide" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 18, background: form.themeBackgroundColor || "#ffffff", color: form.themeTextColor || "#111111" }}>
          <p style={{ margin: "0 0 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em", opacity: 0.6 }}>Live storefront appearance preview:</p>
          {form.fontFamily && <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(form.fontFamily)}:wght@400;500;600;700&display=swap`} />}
          {form.bodyFontFamily && form.bodyFontFamily !== "system-ui" && <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(form.bodyFontFamily)}:wght@400;500;600&display=swap`} />}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, alignItems: "center" }}>
            <div style={{ padding: 16, background: form.themeSurfaceColor || "#faf9f6", borderRadius: form.themeRadius === "sharp" ? 0 : form.themeRadius === "rounded" ? 12 : form.themeRadius === "pill" ? 22 : 4, border: "1px solid rgba(0,0,0,0.08)" }}>
              <span style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", opacity: 0.6, display: "block", marginBottom: 6 }}>Luxury Collection</span>
              <h4 style={{ fontFamily: `"${form.fontFamily}", Georgia, serif`, fontSize: 22, margin: "0 0 6px", fontWeight: 500, color: form.themeTextColor || "#111111" }}>
                Pure Linen Shalwar Kameez
              </h4>
              <p style={{ fontFamily: form.bodyFontFamily === "system-ui" ? "system-ui, sans-serif" : `"${form.bodyFontFamily}", sans-serif`, fontSize: 13, margin: "0 0 12px", opacity: 0.75, lineHeight: 1.5 }}>
                Bespoke cut from hand-selected yarns, finished with pearl-inlay buttons.
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                <strong style={{ fontSize: 16, fontFamily: form.bodyFontFamily === "system-ui" ? "system-ui, sans-serif" : `"${form.bodyFontFamily}", sans-serif` }}>PKR 14,500</strong>
                <span
                  style={{
                    background: form.themeAccentColor || "#c5a059",
                    color: "#ffffff",
                    padding: "7px 16px",
                    borderRadius: form.themeRadius === "sharp" ? 0 : form.themeRadius === "rounded" ? 8 : form.themeRadius === "pill" ? 999 : 4,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    display: "inline-block",
                  }}
                >
                  Add to Bag
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Corner Radius:</span>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>{form.themeRadius || "subtle"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Display Font:</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{form.fontFamily}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Body Font:</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{form.bodyFontFamily}</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="tcs" title="TCS delivery" intro="Where TCS collects parcels from. The TCS account login is stored safely on the server — see the note below.">
        {text("tcsShipperName", "Name on the parcel (sender)", { hint: "The sender name TCS prints on the label." })}
        {text("tcsShipperPhone", "Pickup contact phone", { placeholder: "03116111963", hint: "The rider calls this number when coming to collect." })}
        <div className="a-field wide">
          <label htmlFor="s-tcsShipperAddress">
            Pickup address <Hint text="Full address where the TCS rider should come, with area and landmark." />
          </label>
          <textarea id="s-tcsShipperAddress" rows={2} value={form.tcsShipperAddress} onChange={set("tcsShipperAddress")} placeholder="Shop / house number, street, area" />
        </div>
        <div className="a-field">
          <label htmlFor="s-city">Pickup city</label>
          <select
            id="s-city"
            value={form.tcsShipperCityName}
            onChange={(event) => {
              const city = event.target.value;
              setForm((current) => ({ ...current, tcsShipperCityName: city, tcsShipperCityCode: CITY_CODES.find(([name]) => name === city)?.[1] ?? current.tcsShipperCityCode }));
              setDirty(true);
            }}
          >
            {!CITY_CODES.some(([name]) => name === form.tcsShipperCityName) && <option>{form.tcsShipperCityName}</option>}
            {CITY_CODES.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        {text("tcsShipperCityCode", "City code", { hint: "TCS's short code for your city (Karachi = KHI, Lahore = LHE). It fills in by itself when you pick the city." })}
        <div className="wide a-note">
          <Icon name="info" />
          <div>
            <strong>Connecting your TCS account.</strong> TCS gives you a username, password, account number and cost-centre code when they approve you for online booking. These are private, so they are added to the server by whoever manages your website — not typed here. Until then, book on the TCS website and use <em>“I booked it on the TCS website”</em> on the order.
            <div className="a-row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="a-btn a-btn-sm"
                disabled={testing.pending}
                onClick={() =>
                  testing.run(async () => {
                    setTestResult(null);
                    const result = await callApi<{ ok: boolean; error?: string; environment?: string }>("/api/admin/courier/test", "POST");
                    if (result.ok) setTestResult(result.data.ok ? { ok: true, text: `Connected to TCS (${result.data.environment} mode).` } : { ok: false, text: result.data.error ?? "Could not connect." });
                    else setTestResult({ ok: false, text: result.error });
                  })
                }
              >
                {testing.pending ? <span className="spinner" aria-hidden="true" /> : null} Test TCS connection
              </button>
              {testResult && <span className={testResult.ok ? "a-delta-up" : "a-error"} role="status">{testResult.text}</span>}
            </div>
          </div>
        </div>
      </Section>

      <Section id="topbar" title="Top bar of your website" intro="The thin strip at the very top of every page. It slides through these lines one after another.">
        <fieldset className="wide" style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 10 }}>
          <legend className="sr-only">What the top bar shows</legend>
          {choice("announcementMode", "auto", "Automatic (recommended)", "Built from your real rules, so it can never be wrong: cash on delivery, and “Free delivery on orders above Rs. …” using the free-delivery amount below. Your own lines are added after them.")}
          {choice("announcementMode", "custom", "Only my own lines", "Shows just what you type below.")}
          {choice("announcementMode", "off", "Hide the top bar", "No strip at the top.")}
        </fieldset>
        {form.announcementMode !== "off" && (
          <div className="a-field wide">
            <label htmlFor="s-announcementLines">
              {form.announcementMode === "custom" ? "Your lines" : "Extra lines (optional)"} <Hint text="One message per line, up to 6 lines. Example: New arrivals every week" />
            </label>
            <textarea id="s-announcementLines" rows={4} value={form.announcementLines} onChange={(event) => setValue("announcementLines", event.target.value)} placeholder={"New arrivals every week\nEid collection is live"} maxLength={1200} />
          </div>
        )}
        {form.announcementMode !== "off" && (
          <fieldset className="wide" style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 10 }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>How the lines move</legend>
            {choice("announcementStyle", "rotate", "One line at a time (Recommended)", "Calm luxury fade & slide. Stays stationary for 4.5 seconds for effortless reading.")}
            {choice("announcementStyle", "scroll-left", "Slide from right", "Smooth luxury carousel entering from the right, pausing 4.5 seconds on each line.")}
            {choice("announcementStyle", "scroll-right", "Slide from left", "Smooth luxury carousel entering from the left, pausing 4.5 seconds on each line.")}
          </fieldset>
        )}
        <div className="wide">
          <p className="a-help" style={{ marginBottom: 6 }}>How it will look (your website updates when you press Save):</p>
          {topBarPreview.length ? (
            <ul style={{ margin: 0, padding: "10px 16px", listStyle: "none", background: "#111", color: "#fff", borderRadius: 8, display: "grid", gap: 4, fontSize: 13, letterSpacing: ".04em" }}>
              {topBarPreview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="a-muted">The top bar is hidden.</p>
          )}
          {topBarPreview.length > 0 && (
            <button type="button" className="a-btn" style={{ marginTop: 10 }} onClick={() => setPreviewOpen(true)}>
              <Icon name="eye" size={16} /> Preview on phone and computer
            </button>
          )}
        </div>
      </Section>

      <Section id="delivery" title="Delivery, payment and refunds">
        {text("freeDeliveryThreshold", "Free delivery above (PKR)", { hint: "Orders worth more than this get free delivery. Put 0 to switch free delivery off." })}
        <fieldset className="wide" style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 10 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>What customers pay for delivery <Hint text="This is what the CUSTOMER is charged. TCS bills you separately for carrying the parcel – the two do not have to be equal. Free delivery above the amount is always applied, whichever way you choose." /></legend>
          {choice("deliveryMode", "zones", "A price for each area (recommended)", "You set the price per area on the “Delivery charges” page, for example Karachi Rs 250, rest of Pakistan Rs 400.")}
          {choice("deliveryMode", "flat", "One price everywhere", "The same delivery charge for all of Pakistan.")}
          {choice("deliveryMode", "tcs", "Follow TCS prices (when available)", "Uses TCS's own tariff by city once TCS is connected. Until then, or for any city TCS cannot price, your area prices are used – so an order is never blocked.")}
        </fieldset>
        {form.deliveryMode === "flat" && text("flatDeliveryCharge", "Delivery charge everywhere (PKR)", { hint: "Charged on every order below the free-delivery amount." })}
        <label className="a-check wide">
          <input type="checkbox" checked={form.bankDepositEnabled} onChange={(event) => setValue("bankDepositEnabled", event.target.checked)} />
          <span>
            <strong>Also accept bank transfer</strong>
            <small className="a-help" style={{ display: "block" }}>{form.bankDepositEnabled ? "Customers can choose bank transfer and upload a receipt. Fill in your bank details below." : "Off: customers can only choose cash on delivery. Turn this on when you are ready to check bank receipts."}</small>
          </span>
        </label>
        {text("refundWindowDays", "Refund time (days)", { hint: "How many days after delivery a customer may ask for a refund. 0 = no refunds." })}
        {text("codReservationHours", "Hold stock for cash-on-delivery orders (hours)", { hint: "If the customer does not confirm in this time, the order is cancelled and the stock goes back on sale." })}
        {text("bankReservationHours", "Hold stock for bank-transfer orders (hours)", { hint: "How long a customer has to send the receipt." })}
        {text("bankName", "Bank name", { placeholder: "e.g. Meezan Bank" })}
        {text("bankAccountTitle", "Account title")}
        {text("bankAccountNumber", "Account number")}
        {text("bankIban", "IBAN", { placeholder: "PK00 XXXX 0000 0000 0000 0000" })}
      </Section>

      <Section id="alerts" title="Order alerts" intro="A pop-up on this computer the moment something needs you.">
        <div className="wide a-stack" style={{ gap: 8 }}>
          <p>Press <strong>“Turn on order alerts”</strong> at the bottom-left of the screen, and choose <strong>Allow</strong> when the browser asks. Do this on every computer you use.</p>
          <p className="a-muted">You will get an alert for: a new order, a payment receipt, a refund request, an order cancelled by a customer, and when something is running low or sold out.</p>
          {!status.push && <p className="a-note warn"><Icon name="alert" />Alerts are not set up on the server yet, so none will arrive until they are.</p>}
        </div>
      </Section>

      <Section id="tracking" title="Advertising and visitor counting (optional)" intro="Leave empty if you do not use them.">
        {text("metaPixelId", "Facebook / Instagram Pixel ID", { hint: "Lets Facebook show your ads to the right people and count sales." })}
        {text("gaMeasurementId", "Google Analytics ID", { placeholder: "G-XXXXXXXXXX", hint: "Counts visitors to your website." })}
      </Section>

      <details className="a-card" id="advanced" style={{ scrollMarginTop: 84 }}>
        <summary className="a-card-head" style={{ cursor: "pointer" }}>
          <div>
            <h2>Advanced</h2>
            <small>Most shops never need to change these. The normal choices are already set.</small>
          </div>
        </summary>
        <div className="a-card-pad a-form-grid">
          {text("soldoutHideDays", "Hide sold-out products after (days)", {
            hint: "When every size of a product has been sold out, and nobody has bought or changed it for this many days, it is hidden from your website. Nothing is deleted – you can show it again whenever you restock. Put 0 to keep sold-out products on your website forever.",
            help: form.soldoutHideDays === 0 ? "Sold-out products stay on your website forever." : `Products sold out for ${form.soldoutHideDays} days or more are hidden automatically.`,
          })}
          {text("googleSiteVerification", "Google Search Console code", { wide: true, placeholder: "Paste the code (or the whole meta tag) from Google", hint: "Search Console is Google's free tool that shows how your website appears in Google and lets you send it your sitemap. It asks you to prove the website is yours – paste its code here and press Save, then press Verify in Search Console.", help: "Never add anything by hand to the website – this box does it for you." })}
          {text("bingSiteVerification", "Bing Webmaster code", { wide: true, placeholder: "Paste the code from Bing Webmaster Tools", hint: "The same idea for Bing, which also powers other search tools and some AI assistants." })}
          <PhotoShrinker />
        </div>
      </details>

      <div className="a-savebar">
        <span className="a-muted">{dirty ? "You have changes that are not saved yet." : "Everything is saved."}</span>
        <button className="a-btn a-btn-primary a-btn-lg" disabled={saving.pending || !dirty} aria-busy={saving.pending}>
          {saving.pending ? <span className="busy-label"><span className="spinner spinner-light" aria-hidden="true" /> Saving…</span> : "Save settings"}
        </button>
      </div>
      {previewOpen && (
        <Dialog title="Top bar preview" wide onClose={() => setPreviewOpen(false)}>
          <TopBarPreview messages={topBarPreview} style={isAnnouncementStyle(form.announcementStyle) ? form.announcementStyle : "rotate"} />
        </Dialog>
      )}
    </form>
  );
}

function TopBarPreview({ messages, style }: { messages: string[]; style: "rotate" | "scroll-left" | "scroll-right" }) {
  const frame = (label: string, width: number | string, isPhone?: boolean) => (
    <div style={{ minWidth: 0 }}>
      <p className="a-help" style={{ margin: "0 0 6px", fontWeight: 600 }}>{label}</p>
      <div
        className="a-device"
        style={{
          width,
          maxWidth: "100%",
          margin: isPhone ? "0 auto" : undefined,
          borderRadius: isPhone ? 28 : 12,
          border: isPhone ? "6px solid #1f2937" : "1px solid var(--line-strong)",
          boxShadow: isPhone ? "0 12px 30px rgba(0,0,0,0.15)" : "0 4px 16px rgba(0,0,0,0.06)",
        }}
      >
        <AnnouncementBar key={`${style}-${messages.join("|")}`} messages={messages} style={style} />
        <div className="a-device-header" style={{ height: isPhone ? 48 : 56, padding: "0 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, letterSpacing: "0.05em", color: "#666" }}>☰</span>
          <strong style={{ letterSpacing: ".15em", fontSize: isPhone ? 12 : 14 }}>NURE ASMIR</strong>
          <span style={{ fontSize: 13, letterSpacing: "0.05em", color: "#666" }}>🛒 (0)</span>
        </div>
        <div className="a-device-body" style={{ height: isPhone ? 90 : 80, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #f5f5f4 0%, #e7e5e4 100%)", color: "#78716c", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase" }}>
          Storefront Hero Viewport
        </div>
      </div>
    </div>
  );
  return (
    <div className="a-device-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
      {frame("📱 Phone screen", 340, true)}
      {frame("🖥️ Desktop screen", "100%", false)}
      <p className="a-help" style={{ gridColumn: "1 / -1", margin: 0 }}>
        This is an exact, live simulation of what shoppers see at the top of your site. Each line stays completely still for 4.5 seconds for effortless reading before gently transitioning.
      </p>
    </div>
  );
}
