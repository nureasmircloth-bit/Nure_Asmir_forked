import { googleFontHref } from "@/lib/fonts";
import { chromeCss } from "@/lib/theme-chrome";
import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Figtree, Lato } from "next/font/google";
import "./globals.css";
import "./storefront.css";
import { BRAND, normalizeOrigin, siteOrigin } from "@/lib/brand";
import { getPublicSettings } from "@/lib/commerce";
import { getNonce } from "@/lib/nonce";
import { getSiteImages } from "@/lib/site-images";
import { AnalyticsConsent } from "./analytics-consent";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

// Body and product text: Figtree, a free humanist sans that stands in for Ismail Farid's Whitney Light (a licensed font we cannot ship).
const sans = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  preload: false,
});

// Prices: Lato Light, the same font Ismail Farid uses for its prices.
const price = Lato({
  variable: "--font-price",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  display: "swap",
  preload: false,
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw edge to edge on notched phones; floating widgets add the safe-area insets themselves.
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export async function generateMetadata(): Promise<Metadata> {
  const origin = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL, "http://localhost:3000");
  const share = (await getSiteImages()).share_image;
  const shareUrl = share ? (/^https?:\/\//.test(share.url) ? share.url.split("?")[0] : `${origin}${share.url.split("?")[0]}`) : `${origin}/og.jpg`;
  const settings = await getPublicSettings();
  const title = `${BRAND.name} — ${BRAND.descriptor}`;
  return {
    metadataBase: new URL(origin),
    title: { default: `${title}. ${BRAND.tagline}.`, template: `%s | ${BRAND.name}` },
    description: settings.shopDescription || BRAND.description,
    applicationName: BRAND.name,
    icons: {
      icon: [
        { url: "/logo.ico", sizes: "32x32" },
        { url: "/logo-icon.png", type: "image/png", sizes: "512x512" },
      ],
      shortcut: "/logo.ico",
      apple: "/apple-touch-icon.png",
    },
    openGraph: {
      title: `${title} — ${BRAND.tagline}`,
      description: settings.shopDescription || BRAND.description,
      type: "website",
      locale: "en_PK",
      siteName: BRAND.name,
      images: [{ url: shareUrl, width: 1200, height: 630, alt: `${BRAND.name} — ${BRAND.tagline}` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — ${BRAND.tagline}`,
      description: settings.shopDescription || BRAND.description,
      images: [shareUrl],
    },
    robots: { index: true, follow: true },
    ...(settings.googleSiteVerification || settings.bingSiteVerification
      ? { verification: { ...(settings.googleSiteVerification ? { google: settings.googleSiteVerification } : {}), ...(settings.bingSiteVerification ? { other: { "msvalidate.01": settings.bingSiteVerification } } : {}) } }
      : {}),
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = await getPublicSettings();
  const nonce = getNonce();
  const origin = siteOrigin();

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: BRAND.name,
        url: origin,
        logo: `${origin}/logo.png`,
        description: BRAND.description,
        areaServed: { "@type": "Country", name: "Pakistan" },
        ...(settings.supportEmail ? { email: settings.supportEmail } : {}),
        ...(settings.supportPhone ? { telephone: settings.supportPhone } : {}),
        sameAs: [settings.instagramUrl, settings.facebookUrl, settings.tiktokUrl].filter(Boolean),
      },
      {
        "@type": "WebSite",
        name: BRAND.name,
        url: origin,
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${origin}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  // Google fonts chosen in Settings (the built-in heading and body fonts come with the site and are not requested).
  const fontNames = new Set<string>();
  if (settings.fontFamily && settings.fontFamily !== "Cormorant Garamond") fontNames.add(settings.fontFamily.trim());
  if (settings.bodyFontFamily && settings.bodyFontFamily !== "Figtree") fontNames.add(settings.bodyFontFamily.trim());
  if (settings.contactFontFamily) fontNames.add(settings.contactFontFamily.trim());
  const fontHrefs = [...fontNames].map((name) => googleFontHref(name)).filter((href): href is string => Boolean(href));

  return (
    <html lang="en-PK" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${price.variable}`}>
      <head>
        <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {fontHrefs.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <style
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --paper: ${settings.themeBackgroundColor || "#ffffff"};
                --ink: ${settings.themeTextColor || "#111111"};
                --gold: ${settings.themeAccentColor || "#c5a059"};
                --accent: ${settings.themeAccentColor || "#c5a059"};
                --silk: ${settings.themeSurfaceColor || "#faf9f6"};
                --ivory: ${settings.themeSurfaceColor || "#faf9f6"};
                --line: color-mix(in srgb, ${settings.themeTextColor || "#111111"} 14%, transparent);
                --muted: color-mix(in srgb, ${settings.themeTextColor || "#111111"} 55%, transparent);
                --radius-theme: ${settings.themeRadius === "sharp" ? "0px" : settings.themeRadius === "rounded" ? "10px" : settings.themeRadius === "pill" ? "24px" : "4px"};
                ${settings.fontFamily && settings.fontFamily !== "Cormorant Garamond" ? `--font-display: "${settings.fontFamily}", Georgia, serif; --display: "${settings.fontFamily}", Georgia, serif;` : ""}
                ${settings.bodyFontFamily && settings.bodyFontFamily !== "Figtree" ? `--font-sans: ${settings.bodyFontFamily === "system-ui" ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" : `"${settings.bodyFontFamily}", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`}; --sans: ${settings.bodyFontFamily === "system-ui" ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" : `"${settings.bodyFontFamily}", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`};` : ""}
                ${settings.contactFontFamily ? `--contact-font: ${settings.contactFontFamily === "system-ui" ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" : `"${settings.contactFontFamily}", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`};` : ""}
              }
              body {
                background-color: var(--paper) !important;
                color: var(--ink) !important;
                font-family: var(--sans) !important;
              }
              .cart-page, .checkout-page, .track-page, .content-page, .story-page, .search-overlay, .fp, .size-guide {
                background-color: var(--paper) !important;
                color: var(--ink) !important;
              }
              .contact-page {
                font-family: var(--contact-font, var(--sans));
              }
              .contact-page h1 {
                font-family: var(--contact-font, var(--sans)) !important;
                font-weight: 600;
                letter-spacing: -0.02em;
              }
              ${chromeCss(settings)}
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        {children}
        <AnalyticsConsent metaPixelId={settings.metaPixelId} gaMeasurementId={settings.gaMeasurementId} nonce={nonce} />
      </body>
    </html>
  );
}
