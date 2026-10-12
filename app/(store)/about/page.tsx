import type { Metadata } from "next";
import { StoryBody } from "@/components/story-body";
import { DEFAULT_ABOUT_BODY, DEFAULT_ABOUT_HEADING } from "@/lib/about-content";
import { getPublicSettings } from "@/lib/commerce";
import { getSiteImages } from "@/lib/site-images";
import { StoreFooter } from "../_components/store-footer";
import { Breadcrumbs } from "../_components/breadcrumbs";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Our story",
  description: "Nure Asmir is a Pakistani men's wear label — tradition in a modern form. Shalwar kameez, shirts, pants and accessories.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const [images, settings] = await Promise.all([getSiteImages(), getPublicSettings()]);
  const photo = images.about_hero;
  const photoMobile = images.about_hero_mobile;
  const fallbackUrl = "/cdn/products/seed-noir-kameez-shalwar-with-waistcoat-1-w960.webp";
  const heading = settings.aboutHeading.trim() || DEFAULT_ABOUT_HEADING;
  const body = settings.aboutBody.trim() || DEFAULT_ABOUT_BODY;
  return (
    <main>
      <div className="crumb-bar"><Breadcrumbs trail={[{ name: "Our story" }]} path="/about" pageType="AboutPage" /></div>
      <section className="story-page">
        <div className="story-image">
          <picture style={{ width: "100%", height: "100%", display: "block", position: "relative" }}>
            {photoMobile?.url ? (
              <source media="(max-width: 640px)" srcSet={photoMobile.url} />
            ) : null}
            <img
              src={photo?.url ?? fallbackUrl}
              alt={photo?.alt || photoMobile?.alt || "Nure Asmir men's wear"}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              loading="eager"
            />
          </picture>
        </div>
        <article>
          <p className="eyebrow">Our story</p>
          <h1>{heading}</h1>
          <StoryBody body={body} />
        </article>
      </section>

      <StoreFooter />
    </main>
  );
}
