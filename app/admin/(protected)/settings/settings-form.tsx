"use client";

import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useState } from "react";
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

export function SettingsForm({ initial, status }: { initial: SettingsValues; status: SystemStatus }) {
  const router = useRouter();
  const toast = useToast();
  const saving = useLockedAction();
  const testing = useLockedAction();
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

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
      const result = await callApi<{ settings: Partial<Record<keyof SettingsValues, string | number>> }>("/api/admin/settings", "PATCH", form);
      if (result.ok) {
        // Show what was actually stored (web addresses get https:// added, phone numbers are tidied).
        const saved = result.data.settings ?? {};
        setForm((current) => ({ ...current, ...Object.fromEntries((Object.keys(current) as Array<keyof SettingsValues>).filter((key) => saved[key] !== undefined).map((key) => [key, saved[key]])) }));
        toast("Settings saved. Your website is updating.", "good");
        setDirty(false);
        router.refresh();
      } else toast(result.error, "bad");
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
        {text("supportPhone", "Phone number", { placeholder: "+92 311 6111963", hint: "Customers can tap this number to call you." })}
        {text("whatsappNumber", "WhatsApp number", { hint: "The number for the green WhatsApp button on your website.", placeholder: "+92 311 6111963" })}
        {text("whatsappChatUrl", "WhatsApp chat link (optional)", { hint: "A link that opens a chat with you, like wa.me/message/… from WhatsApp Business. If empty, we use your WhatsApp number.", placeholder: "https://wa.me/message/…" })}
        {text("supportEmail", "Email address", { type: "email", placeholder: "hello@nureasmir.com" })}
        {text("instagramUrl", "Instagram page", { placeholder: "https://www.instagram.com/yourname" })}
        {text("facebookUrl", "Facebook page", { placeholder: "https://www.facebook.com/yourpage" })}
        {text("tiktokUrl", "TikTok page", { placeholder: "https://www.tiktok.com/@yourname" })}
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
            {choice("announcementStyle", "rotate", "One line at a time", "Each line slides in after a few seconds, then the next one. The way it works today.")}
            {choice("announcementStyle", "scroll-left", "Scrolling, towards the left", "All lines glide across in one loop, like a news ticker. Touching it pauses it.")}
            {choice("announcementStyle", "scroll-right", "Scrolling, towards the right", "The same loop, moving the other way.")}
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

/** The real top bar, drawn twice: in a phone-sized frame and in a computer-sized frame, moving exactly as it will on the website. */
function TopBarPreview({ messages, style }: { messages: string[]; style: "rotate" | "scroll-left" | "scroll-right" }) {
  const frame = (label: string, width: number | string) => (
    <div>
      <p className="a-help" style={{ margin: "0 0 6px" }}>{label}</p>
      <div className="a-device" style={{ width, maxWidth: "100%" }}>
        <AnnouncementBar key={`${style}-${messages.join("|")}`} messages={messages} style={style} />
        <div className="a-device-header">
          <span />
          <strong>NURE ASMIR</strong>
          <span />
        </div>
        <div className="a-device-body" />
      </div>
    </div>
  );
  return (
    <div className="a-device-row">
      {frame("On a phone", 375)}
      {frame("On a computer", "100%")}
      <p className="a-help">This is the same top bar your shoppers get. Press Save settings to put it on your website.</p>
    </div>
  );
}
