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

export default async function ContactPage() {
  const [settings, locations] = await Promise.all([getPublicSettings(), getStoreLocations()]);
  const whatsapp = String(settings.whatsappNumber ?? "").replace(/\D/g, "");

  return (
    <main>
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
              <p>
                {shop.address}
                {shop.city ? `, ${shop.city}` : ""}
              </p>
              {shop.hours && <p>{shop.hours}</p>}
              {shop.phone && <a href={`tel:${shop.phone.replace(/\s/g, "")}`}>{shop.phone}</a>}
              {shop.latitude != null && shop.longitude != null && (
                <a href={mapsLink(shop.latitude, shop.longitude)} target="_blank" rel="noreferrer noopener">
                  Open in maps ↗︎
                </a>
              )}
            </article>
          ))}
          <article>
            <span>WhatsApp Business</span>
            {settings.whatsappChatUrl || whatsapp ? (
              <a href={settings.whatsappChatUrl || `https://wa.me/${whatsapp}?text=${encodeURIComponent("Hello Nure Asmir, I would like some assistance.")}`} target="_blank" rel="noreferrer">
                Start a conversation ↗︎
              </a>
            ) : (
              <p>Coming soon.</p>
            )}
          </article>
          <article>
            <span>Email</span>
            {settings.supportEmail ? <a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a> : <p>Coming soon.</p>}
          </article>
          <article>
            <span>Phone</span>
            {settings.supportPhone ? <a href={`tel:${settings.supportPhone.replace(/\s/g, "")}`}>{settings.supportPhone}</a> : <p>Coming soon.</p>}
          </article>
          <article>
            <span>Instagram</span>
            {settings.instagramUrl ? (
              <a href={settings.instagramUrl} target="_blank" rel="noreferrer">
                Visit Instagram ↗︎
              </a>
            ) : (
              <p>Coming soon.</p>
            )}
          </article>
          <article>
            <span>Facebook</span>
            {settings.facebookUrl ? (
              <a href={settings.facebookUrl} target="_blank" rel="noreferrer">
                Visit Facebook ↗︎
              </a>
            ) : (
              <p>Coming soon.</p>
            )}
          </article>
          <article>
            <span>TikTok</span>
            {settings.tiktokUrl ? (
              <a href={settings.tiktokUrl} target="_blank" rel="noreferrer">
                Visit TikTok ↗︎
              </a>
            ) : (
              <p>Coming soon.</p>
            )}
          </article>
          <article>
            <span>Existing order</span>
            <Link href="/track-order">Track an order →︎</Link>
          </article>
        </aside>
      </section>

      <StoreFooter />
    </main>
  );
}
