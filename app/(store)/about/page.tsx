import type { Metadata } from "next";
import Image from "next/image";
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
  const heading = settings.aboutHeading.trim() || DEFAULT_ABOUT_HEADING;
  const body = settings.aboutBody.trim() || DEFAULT_ABOUT_BODY;
  return (
    <main>
      <div className="crumb-bar"><Breadcrumbs trail={[{ name: "Our story" }]} path="/about" pageType="AboutPage" /></div>
      <section className="story-page">
        <div className="story-image">
          <Image src={photo?.url ?? "/og.jpg"} alt={photo?.alt || "Nure Asmir men's wear"} fill priority sizes="50vw" {...(photo?.blurDataUrl ? { placeholder: "blur" as const, blurDataURL: photo.blurDataUrl } : {})} />
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
