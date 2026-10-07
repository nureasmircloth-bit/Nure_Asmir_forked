import Image from "next/image";
import Link from "next/link";
import { getActiveCategories, getPublicSettings } from "@/lib/commerce";
import { BRAND } from "@/lib/brand";
import { getStoreLocations } from "@/lib/locations";
import { ShowWidgetsLink } from "./floating-widgets";
import { NewsletterForm } from "./store-components";
import { FacebookIcon, InstagramIcon, TikTokIcon, WhatsAppIcon } from "./icons";

export async function StoreFooter() {
  const [settings, categories, locations] = await Promise.all([getPublicSettings(), getActiveCategories(), getStoreLocations()]);
  const whatsapp = settings.whatsappChatUrl || (settings.whatsappNumber ? `https://wa.me/${settings.whatsappNumber.replace(/[^\d]/g, "")}` : "/contact");

  return (
    <>
      <section className="newsletter" aria-labelledby="newsletter-title">
        <h2 id="newsletter-title">Subscribe to our newsletter</h2>
        <p>Sign up for new arrivals, offers and more.</p>
        <NewsletterForm />
      </section>
      <footer className="footer">
        <div className="footer-main">
          <div className="footer-brand">
            <Image src="/brand/wordmark-light-v2.png" alt={BRAND.name} width={969} height={155} unoptimized />
            <p>{BRAND.description}</p>
            <div className="footer-social">
              {settings.facebookUrl && (
                <a href={settings.facebookUrl} target="_blank" rel="noreferrer noopener" aria-label="Facebook">
                  <FacebookIcon />
                </a>
              )}
              {settings.instagramUrl && (
                <a href={settings.instagramUrl} target="_blank" rel="noreferrer noopener" aria-label="Instagram">
                  <InstagramIcon />
                </a>
              )}
              {settings.tiktokUrl && (
                <a href={settings.tiktokUrl} target="_blank" rel="noreferrer noopener" aria-label="TikTok">
                  <TikTokIcon />
                </a>
              )}
              <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                <WhatsAppIcon size={18} />
              </a>
            </div>
          </div>
          <div className="footer-links">
            <div>
              <h3>Shop</h3>
              <Link href="/shop">New arrivals</Link>
              {categories.map((category) => (
                <Link key={category.slug} href={`/collections/${category.slug}`}>
                  {category.name}
                </Link>
              ))}
            </div>
            <div>
              <h3>Customer care</h3>
              <Link href="/track-order">Track your order</Link>
              <Link href="/faq">FAQ</Link>
              <Link href="/policies/shipping">Shipping</Link>
              <Link href="/policies/returns">Returns &amp; exchanges</Link>
              <Link href="/contact">Contact us</Link>
            </div>
            {locations.length > 0 && (
              <div>
                <h3>Visit us</h3>
                {locations.map((shop) => (
                  <Link key={shop.id} href="/contact">
                    {locations.length > 1 ? `${shop.name}: ` : ""}
                    {shop.address}
                    {shop.city ? `, ${shop.city}` : ""}
                  </Link>
                ))}
              </div>
            )}
            <div>
              <h3>Company</h3>
              <Link href="/about">Our story</Link>
              <Link href="/policies/privacy">Privacy policy</Link>
              <Link href="/policies/terms">Terms of service</Link>
              {settings.supportPhone && <a href={`tel:${settings.supportPhone.replace(/\s/g, "")}`}>{settings.supportPhone}</a>}
              {settings.supportEmail && <a href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a>}
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </span>
          <span>Prices in PKR · Cash on delivery nationwide</span>
          <ShowWidgetsLink />
          {/* The admin panel is a separate deployment – nothing of it loads until this link is opened. */}
          <a href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin"} rel="nofollow">
            Admin
          </a>
        </div>
      </footer>
    </>
  );
}
