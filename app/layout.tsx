import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
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
});

const sans = Jost({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
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
    description: BRAND.description,
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
      description: BRAND.description,
      type: "website",
      locale: "en_PK",
      siteName: BRAND.name,
      images: [{ url: shareUrl, width: 1200, height: 630, alt: `${BRAND.name} — ${BRAND.tagline}` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — ${BRAND.tagline}`,
      description: BRAND.description,
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

  return (
    <html lang="en-PK" data-scroll-behavior="smooth" className={`${display.variable} ${sans.variable}`}>
      <head>
        <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>
        {children}
        <AnalyticsConsent metaPixelId={settings.metaPixelId} gaMeasurementId={settings.gaMeasurementId} nonce={nonce} />
      </body>
    </html>
  );
}
