import Link from "next/link";
import { siteOrigin } from "@/lib/brand";
import { getNonce } from "@/lib/nonce";

export type Crumb = { name: string; href?: string };

/**
 * The "Home / Shop / Shirts" trail at the top of inner pages, written twice: once for people (links they can follow) and once for
 * search engines (BreadcrumbList structured data). The last item is the page itself and is not a link.
 * `pageType` also tells search engines what kind of page this is (about, contact or a plain page).
 */
export function Breadcrumbs({ trail, path, pageType = "WebPage", description }: { trail: Crumb[]; path: string; pageType?: "WebPage" | "AboutPage" | "ContactPage"; description?: string }) {
  const origin = siteOrigin();
  const all: Crumb[] = [{ name: "Home", href: "/" }, ...trail];
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: all.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: `${origin}${crumb.href ?? path}`.replace(/\/$/, "") || origin })),
    },
    {
      "@context": "https://schema.org",
      "@type": pageType,
      name: trail[trail.length - 1]?.name,
      url: `${origin}${path}`,
      ...(description ? { description } : {}),
      isPartOf: { "@type": "WebSite", name: "Nure Asmir", url: origin },
    },
  ];
  return (
    <>
      <script type="application/ld+json" nonce={getNonce()} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {all.map((crumb, index) => (
          <span key={`${crumb.name}-${index}`} style={{ display: "contents" }}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {index < all.length - 1 && crumb.href ? <Link href={crumb.href}>{crumb.name}</Link> : <span aria-current={index === all.length - 1 ? "page" : undefined}>{crumb.name}</span>}
          </span>
        ))}
      </nav>
    </>
  );
}
