import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { DEFAULT_ABOUT_BODY, DEFAULT_ABOUT_HEADING } from "@/lib/about-content";
import { PageHeader } from "../../_ui/ui";
import { StoryForm } from "./story-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Our story page" };

export default async function AdminStoryPage() {
  const [row] = await db.select({ heading: siteSettings.aboutHeading, body: siteSettings.aboutBody }).from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  return (
    <>
      <PageHeader title="Our story page" intro="The words on the “Our story” page of your website. Change them any time; the picture next to them is changed in Website pictures." />
      <StoryForm initialHeading={row?.heading.trim() || DEFAULT_ABOUT_HEADING} initialBody={row?.body.trim() || DEFAULT_ABOUT_BODY} defaultHeading={DEFAULT_ABOUT_HEADING} defaultBody={DEFAULT_ABOUT_BODY} />
    </>
  );
}
