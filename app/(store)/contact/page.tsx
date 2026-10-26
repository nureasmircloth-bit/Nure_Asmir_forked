import { googleFontHref } from "@/lib/fonts";
import type { Metadata } from "next";
import Link from "next/link";
import { StoreFooter } from "../_components/store-footer";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { getPublicSettings } from "@/lib/commerce";
import { mapsLink } from "@/lib/geo";
import { getStoreLocations } from "@/lib/locations";
import { StoreJsonLd } from "../_components/store-jsonld";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach Nure Asmir for order help, sizing questions or exchanges — by WhatsApp, phone, email or social media.",
  alternates: { canonical: "/contact" },
};

/** A dialable number: digits and one leading "+" only. */
const telHref = (phone: string) => `tel:${phone.trim().replace(/(?!^\+)[^\d]/g, "")}`;

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("923")) {
    return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith("9242")) {
    return `+92 42 ${digits.slice(4)}`;
  }
  if (digits.length === 11 && digits.startsWith("03")) {
    return `+92 ${digits.slice(1, 4)} ${digits.slice(4)}`;
  }
  if (digits.length === 11 && digits.startsWith("042")) {
    return `+92 42 ${digits.slice(3)}`;
  }
  return phone;
}

export default async function ContactPage() {
  const [settings, locations] = await Promise.all([getPublicSettings(), getStoreLocations()]);
  const whatsapp = String(settings.whatsappNumber ?? "").replace(/\D/g, "");

  const whatsappHref = settings.whatsappChatUrl || `https://wa.me/${whatsapp}?text=${encodeURIComponent("Hello Nure Asmir, I would like some assistance.")}`;
  // The font for this page only; a font that every page already loads (the chosen heading or body font) is not asked for twice.
  const globallyLoaded = [settings.fontFamily !== "Cormorant Garamond" ? settings.fontFamily : "", settings.bodyFontFamily !== "Figtree" ? settings.bodyFontFamily : ""];
  const contactFontHref = globallyLoaded.includes(settings.contactFontFamily) ? null : googleFontHref(settings.contactFontFamily);
  return (
    <main>
      {contactFontHref && <link rel="stylesheet" href={contactFontHref} precedence="default" />}
      <StoreJsonLd />
      <div className="crumb-bar"><Breadcrumbs trail={[{ name: "Contact" }]} path="/contact" pageType="ContactPage" /></div>
      <section className="contact-page">
        <div>
          <p className="eyebrow">Customer care</p>
          <h1>We are here to help.</h1>
          <p>
            Product questions, sizing guidance, order confirmation and exchanges — every message reaches a real person
            at Nure Asmir, not a queue. WhatsApp is the fastest way to reach us, especially for order confirmation once you have
            checked out.
          </p>
        </div>
        <aside>
          {locations.map((shop) => (
            <article key={shop.id}>
              <span>{locations.length > 1 ? shop.name : "Visit our shop"}</span>
              <div className="contact-card-content">
                <p>
                  {shop.address}
                  {shop.city ? `, ${shop.city}` : ""}
                </p>
                {shop.hours && <p style={{ color: "var(--muted)", fontSize: 13 }}>{shop.hours}</p>}
                {shop.phone && (
                  <a href={telHref(shop.phone)} className="contact-phone-link">
                    {formatPhone(shop.phone)}
                  </a>
                )}
                {shop.latitude != null && shop.longitude != null && (
                  <a href={mapsLink(shop.latitude, shop.longitude)} target="_blank" rel="noreferrer noopener" className="contact-action-link">
                    Open in maps ↗︎
                  </a>
                )}
              </div>
            </article>
          ))}
          <article>
            <span>WhatsApp</span>
            <div className="contact-card-content">
              {settings.whatsappChatUrl || whatsapp ? (
                <>
                  {settings.whatsappNumber && /\d/.test(settings.whatsappNumber) && (
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noreferrer"
                      className="contact-phone-link"
                    >
                      {formatPhone(settings.whatsappNumber)}
                    </a>
                  )}
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    className="contact-action-link"
                  >
                    Start a conversation ↗︎
                  </a>
                </>
              ) : (
                <p className="contact-muted-text">Coming soon.</p>
              )}
            </div>
          </article>
          <article>
            <span>Direct Call</span>
            <div className="contact-card-content">
              {settings.supportPhone ? (
                <a href={telHref(settings.supportPhone)} className="contact-phone-link">
                  {formatPhone(settings.supportPhone)}
                </a>
              ) : (
                <p className="contact-muted-text">Coming soon.</p>
              )}
            </div>
          </article>
          <article>
            <span>Email</span>
            <div className="contact-card-content">
              {settings.supportEmail ? (
                <a href={`mailto:${settings.supportEmail}`} className="contact-phone-link">
                  {settings.supportEmail}
                </a>
              ) : (
                <p className="contact-muted-text">Coming soon.</p>
              )}
            </div>
          </article>
          <article>
            <span>Instagram</span>
            <div className="contact-card-content">
              {settings.instagramUrl ? (
                <a href={settings.instagramUrl} target="_blank" rel="noreferrer" className="contact-action-link">
                  Visit Instagram ↗︎
                </a>
              ) : (
                <p className="contact-muted-text">Coming soon.</p>
              )}
            </div>
          </article>
          <article>
            <span>Facebook</span>
            <div className="contact-card-content">
              {settings.facebookUrl ? (
                <a href={settings.facebookUrl} target="_blank" rel="noreferrer" className="contact-action-link">
                  Visit Facebook ↗︎
                </a>
              ) : (
                <p className="contact-muted-text">Coming soon.</p>
              )}
            </div>
          </article>
          <article>
            <span>TikTok</span>
            <div className="contact-card-content">
              {settings.tiktokUrl ? (
                <a href={settings.tiktokUrl} target="_blank" rel="noreferrer" className="contact-action-link">
                  Visit TikTok ↗︎
                </a>
              ) : (
                <p className="contact-muted-text">Coming soon.</p>
              )}
            </div>
          </article>
          <article>
            <span>Orders</span>
            <div className="contact-card-content">
              <Link href="/track-order" className="contact-action-link">
                Track an order →︎
              </Link>
            </div>
          </article>
        </aside>
      </section>

      <StoreFooter />
    </main>
  );
}
