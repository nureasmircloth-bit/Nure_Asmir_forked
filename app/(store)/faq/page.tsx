import type { Metadata } from "next";
import Link from "next/link";
import { StoreFooter } from "../_components/store-footer";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { getPublicSettings } from "@/lib/commerce";
import { fillFaqTokens, getActiveFaqs } from "@/lib/faqs";
import { getNonce } from "@/lib/nonce";
import { refundWindowDays } from "@/lib/refunds";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers to common questions about Nure Asmir orders — delivery, cash on delivery, returns, and sizing.",
  alternates: { canonical: "/faq" },
};

export default async function FaqPage() {
  const settings = await getPublicSettings();
  const nonce = getNonce();

  // The owner edits these under Admin → Questions & answers. {{codHours}} / {{freeAbove}} / {{refundDays}} come from the live settings.
  const [rows, refundDays] = await Promise.all([getActiveFaqs(), refundWindowDays()]);
  const values = { codHours: settings.codReservationHours, freeAbove: settings.freeDeliveryThreshold, refundDays };
  const faqs: [string, string][] = rows.map((row) => [fillFaqTokens(row.question, values), fillFaqTokens(row.answer, values)]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <main>
      <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article className="content-page">
        <header>
          <Breadcrumbs trail={[{ name: "FAQ" }]} path="/faq" />
          <p className="eyebrow">Customer care</p>
          <h1>Frequently asked questions</h1>
          <p>Straight answers on delivery, payment, exchanges and sizing.</p>
        </header>
        <div className="product-accordions faq-accordions">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question} <span>+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
        <footer>
          <p>Still have a question?</p>
          <Link className="text-link" href="/contact">
            Contact customer care →︎
          </Link>
        </footer>
      </article>

      <StoreFooter />
    </main>
  );
}
