import type { Metadata } from "next";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { StoreFooter } from "../_components/store-footer";
import { UnsubscribeButton } from "./unsubscribe-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

/** Validates a single email/token pair before showing the email-list unsubscribe confirmation. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ e?: string | string[]; t?: string | string[] }> }) {
  const params = await searchParams;
  // A repeated parameter ("?e=a&e=b") arrives as a list: anything but one plain value is treated as an invalid link.
  const e = typeof params.e === "string" ? params.e : "";
  const t = typeof params.t === "string" ? params.t : "";
  const valid = Boolean(e) && Boolean(t) && (await verifyUnsubscribeToken(e, t));
  return (
    <main>
      <article className="content-page">
        <header>
          <p className="eyebrow">Email list</p>
          <h1>Unsubscribe</h1>
          {valid ? <p>Stop emails about new arrivals and offers to <strong>{e}</strong>? You will still get messages about your own orders.</p> : <p>This link is not valid or has expired. If you keep getting emails you do not want, WhatsApp us and we will remove you.</p>}
        </header>
        {valid && <UnsubscribeButton email={e} token={t} />}
      </article>
      <StoreFooter />
    </main>
  );
}
