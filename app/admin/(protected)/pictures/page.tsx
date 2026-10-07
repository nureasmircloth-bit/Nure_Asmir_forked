import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaignSlides, categories } from "@/db/schema";
import { getSiteImages, SITE_IMAGE_SLOTS } from "@/lib/site-images";
import { HelpBox } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { Badge, PageHeader } from "../../_ui/ui";
import { SiteImageSlot } from "./site-image-slot";

export const dynamic = "force-dynamic";
export const metadata = { title: "Website pictures" };

export default async function PicturesPage() {
  const [slides, cats, overrides] = await Promise.all([
    db.select().from(campaignSlides).where(eq(campaignSlides.active, true)).orderBy(asc(campaignSlides.sortOrder)).limit(6),
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    getSiteImages(),
  ]);

  return (
    <>
      <PageHeader title="Website pictures" intro="Change the pictures your customers see. Everything here goes live within a few seconds of saving." />
      <HelpBox id="pictures">
        <ol>
          <li>
            <strong>Home page banners</strong> are the big pictures at the top of your home page.
          </li>
          <li>
            <strong>Category pictures</strong> are the tall pictures for “Shirts”, “Pants” and so on.
          </li>
          <li>
            <strong>Product photos</strong> are changed inside each product (Products → click a product → Photos).
          </li>
          <li>Pictures are made small and fast automatically — you can upload big photos straight from your phone or camera.</li>
        </ol>
      </HelpBox>

      <section className="a-card" style={{ marginBottom: 18 }}>
        <header className="a-card-head">
          <h2>Home page banners</h2>
          <Link className="a-btn a-btn-primary a-btn-sm" href="/admin/campaign">
            <Icon name="image" size={16} /> Change banners
          </Link>
        </header>
        <div className="a-card-pad">
          {slides.length ? (
            <div className="a-photos" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {slides.map((slide) => (
                <div key={slide.id} className="a-photo">
                  <div className="img" style={{ aspectRatio: "2048 / 768", position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/campaign-media/${slide.id}?v=${slide.updatedAt.getTime()}`} alt={slide.altText} />
                  </div>
                  <small className="a-muted">{slide.headline}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="a-muted">No banner yet. Press “Change banners” to add the first one.</p>
          )}
        </div>
      </section>

      <section className="a-card" style={{ marginBottom: 18 }}>
        <header className="a-card-head">
          <h2>Category pictures</h2>
          <Link className="a-btn a-btn-sm" href="/admin/collections">
            Change category pictures
          </Link>
        </header>
        <div className="a-card-pad">
          <div className="a-photos">
            {cats.map((cat) => (
              <div key={cat.id} className="a-photo">
                <div className="img">
                  {cat.imageR2Key ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/category-media/${cat.id}?v=${cat.updatedAt.getTime()}`} alt={cat.imageAltText ?? cat.name} />
                  ) : null}
                </div>
                <div className="a-row" style={{ justifyContent: "space-between" }}>
                  <strong>{cat.name}</strong>
                  {!cat.imageR2Key && <Badge tone="new">No picture</Badge>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <h2 style={{ fontSize: 18, margin: "24px 0 12px" }}>Other pictures</h2>
      <div className="a-grid a-grid-2">
        {SITE_IMAGE_SLOTS.map((slot) => (
          <SiteImageSlot key={slot.slot} slot={slot.slot} label={slot.label} help={slot.help} size={slot.size} aspect={slot.aspect} fallback={slot.fallback} current={overrides[slot.slot] ? { url: overrides[slot.slot].url, version: overrides[slot.slot].updatedAt } : null} />
        ))}
      </div>
    </>
  );
}
