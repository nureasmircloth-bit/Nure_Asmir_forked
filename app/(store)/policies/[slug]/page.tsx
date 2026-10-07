import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreFooter } from "../../_components/store-footer";
import { Breadcrumbs } from "../../_components/breadcrumbs";
import { getPublicSettings } from "@/lib/commerce";

export const revalidate = 300;

const FREE_DELIVERY_PLACEHOLDER = "__FREE_DELIVERY_THRESHOLD__";
const COD_HOURS_PLACEHOLDER = "__COD_RESERVATION_HOURS__";
const BANK_HOURS_PLACEHOLDER = "__BANK_RESERVATION_HOURS__";
// Wording that depends on whether the owner has switched bank transfer on (Admin → Settings → Delivery, payment and refunds).
const BANK_ORDERS_PLACEHOLDER = "__BANK_ORDERS_SENTENCE__";
const PAYMENT_METHODS_PLACEHOLDER = "__PAYMENT_METHODS__";
const PAYMENT_TERMS_PLACEHOLDER = "__PAYMENT_TERMS__";
const ACCEPTED_PLACEHOLDER = "__ORDER_ACCEPTED__";

type Policy = {
  title: string;
  intro: string;
  sections: [string, string][];
};

const policies: Record<string, Policy> = {
  shipping: {
    title: "Shipping & delivery",
    intro: "Clear delivery expectations for every Nure Asmir order, delivered nationwide across Pakistan.",
    sections: [
      [
        "Order confirmation",
        `Cash-on-delivery orders reserve your stock for ${COD_HOURS_PLACEHOLDER} hours while we confirm the order. ${BANK_ORDERS_PLACEHOLDER}If confirmation or payment is not completed within that window, the reservation may expire and the stock is released.`,
      ],
      [
        "Delivery charges",
        `Delivery is charged according to the delivery zone your city or province falls into — not by parcel weight. The exact charge for your zone is shown at checkout before you place your order. Delivery is complimentary on orders that reach the current free-delivery threshold of PKR ${FREE_DELIVERY_PLACEHOLDER}.`,
      ],
      [
        "Delivery timing",
        "Estimated delivery timing is shown for your selected zone at checkout. Most deliveries within Pakistan are expected within a few working days of order confirmation; remote areas may require additional time. We will let you know if a delay is expected.",
      ],
      [
        "Payment methods",
        PAYMENT_METHODS_PLACEHOLDER,
      ],
      [
        "Receiving your order",
        "Please inspect your parcel promptly on delivery and contact us within 48 hours if it arrives damaged, incomplete or materially different from what you ordered, so we can put it right.",
      ],
    ],
  },
  returns: {
    title: "Returns & exchanges",
    intro: "A straightforward, fair process for pieces that are not quite right.",
    sections: [
      [
        "Return window",
        "You may request a return or exchange within 7 days of delivery. To be eligible, the item must be unworn, unwashed and unused, with all original packaging, tags and protective materials intact.",
      ],
      [
        "How to start a return",
        "Open Track your order, enter your order number and phone number, and press “Ask for a refund” within the 7-day window. Tell us what went wrong (photos help if the item is damaged) and where to send your money. We review every request, and we may arrange a TCS return pickup for you. You can also reach us on WhatsApp.",
      ],
      [
        "Cancelling an order",
        "You can cancel an order yourself on the Track your order page, any time until we hand the parcel to TCS. Once TCS has collected it the order can no longer be cancelled — if you do not want it, you may refuse it at the door and it will come back to us. If you had already paid, we refund you in full.",
      ],
      [
        "Non-returnable items",
        "Items showing wear, marks, scent, alteration or missing packaging cannot be accepted. Final-sale items and any personalised items are not returnable unless they arrive defective.",
      ],
      [
        "Leather accessories",
        "Belts, wallets and card holders must be returned unused and unmarked, with their original packaging and tags, for the same reasons a worn garment cannot be resold.",
      ],
      [
        "Refunds and exchanges",
        "Approved refunds are paid to the bank account, JazzCash or Easypaisa number you give us — usually within a few working days of approval (or of the item reaching us, if it must come back). Original delivery charges are not refundable. Return delivery is the customer's responsibility unless the item received was incorrect, damaged or defective, in which case we cover it.",
      ],
    ],
  },
  privacy: {
    title: "Privacy",
    intro: "How we collect, use and protect your information.",
    sections: [
      [
        "Information we collect",
        "We collect the information needed to process your order and provide support: your name, phone number, delivery address, order history, and — for bank-deposit orders — payment-verification details such as a transaction reference or proof of payment.",
      ],
      [
        "How it is used",
        "Your information is used to fulfil and confirm orders, provide customer care, prevent fraud, meet legal recordkeeping requirements, and send marketing communications only where you have opted in — for example, by joining our newsletter.",
      ],
      [
        "Sharing",
        "We share only what is necessary with delivery couriers, hosting providers and analytics services that help us run the store. We do not sell your personal information to any third party.",
      ],
      [
        "Your choices",
        "You may ask us to access, correct or delete your personal information, or unsubscribe from marketing communications at any time, by contacting our customer care team through the details on our Contact page.",
      ],
      [
        "Cookies and analytics",
        "We use essential cookies to operate the store and, where you consent, analytics tools to understand how the site is used. You can decline non-essential cookies from the banner shown on your first visit.",
      ],
    ],
  },
  terms: {
    title: "Terms of service",
    intro: "The conditions that govern purchases made from Nure Asmir.",
    sections: [
      [
        "Product information",
        "We aim to describe colours, dimensions, materials and pricing as accurately as possible. Screen displays and the natural variation of handmade or natural materials may produce small, reasonable differences from what is pictured.",
      ],
      [
        "Placing an order",
        `An order is accepted once it has been confirmed${ACCEPTED_PLACEHOLDER}. We may decline or cancel an order affected by a pricing error, unavailable stock, suspected fraud, or where the customer cannot be reached.`,
      ],
      [
        "Payments and reservations",
        PAYMENT_TERMS_PLACEHOLDER,
      ],
      [
        "Returns and cancellations",
        "Returns and exchanges are handled under our Returns policy. Orders may be cancelled on the Track your order page until the parcel is handed to TCS; once TCS has collected it, our returns process applies instead.",
      ],
      [
        "Liability",
        "Nothing in these terms limits any right that cannot legally be limited. Otherwise, our liability in connection with an order is limited to the value of that order, to the extent permitted by applicable law.",
      ],
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(policies).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const policy = policies[(await params).slug];
  if (!policy) return {};
  return {
    title: policy.title,
    description: policy.intro,
    alternates: { canonical: `/policies/${(await params).slug}` },
  };
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const policy = policies[slug];
  if (!policy) notFound();

  const settings = await getPublicSettings();
  const threshold = settings.freeDeliveryThreshold.toLocaleString("en-PK");
  const bank = settings.bankDepositEnabled;
  const wording = {
    [BANK_ORDERS_PLACEHOLDER]: bank ? `Bank-deposit orders reserve stock for ${settings.bankReservationHours} hours while your payment is verified. ` : "",
    [PAYMENT_METHODS_PLACEHOLDER]: bank
      ? "We currently accept Cash on Delivery and Bank Deposit only. Online card payment is not yet available. Choose the method that suits you at checkout — both are confirmed using the reservation windows described above."
      : "We currently accept Cash on Delivery all over Pakistan. You pay the rider when your parcel arrives. Online card payment and bank transfer are not available yet.",
    [PAYMENT_TERMS_PLACEHOLDER]: bank
      ? `We accept Cash on Delivery and Bank Deposit only; online card payment is not currently supported. Cash-on-delivery orders reserve stock for ${settings.codReservationHours} hours pending confirmation; bank-deposit orders reserve stock for ${settings.bankReservationHours} hours pending payment verification. Reservations not confirmed or paid within these windows may expire automatically and the stock is released for other customers.`
      : `We accept Cash on Delivery only; online card payment and bank transfer are not currently supported. Cash-on-delivery orders reserve stock for ${settings.codReservationHours} hours pending confirmation. Reservations not confirmed within this window may expire automatically and the stock is released for other customers.`,
    [ACCEPTED_PLACEHOLDER]: bank ? " for cash-on-delivery orders, or once payment has been verified for bank-deposit orders" : " with the customer",
  };
  const sections = policy.sections.map(
    ([title, body]) =>
      [
        title,
        body
          .replaceAll(FREE_DELIVERY_PLACEHOLDER, threshold)
          .replaceAll(COD_HOURS_PLACEHOLDER, String(settings.codReservationHours))
          .replaceAll(BANK_HOURS_PLACEHOLDER, String(settings.bankReservationHours))
          .replace(/__[A-Z_]+__/g, (token) => (token in wording ? wording[token as keyof typeof wording] : token)),
      ] as [string, string],
  );

  return (
    <main>
      <article className="content-page">
        <header>
          <Breadcrumbs trail={[{ name: policy.title }]} path={`/policies/${slug}`} />
          <p className="eyebrow">Customer care</p>
          <h1>{policy.title}</h1>
          <p>{policy.intro}</p>
        </header>
        <div>
          {sections.map(([title, body]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
        <footer>
          <p>Last updated 29 July 2026. Questions about this policy?</p>
          <Link className="text-link" href="/contact">
            Contact customer care →︎
          </Link>
        </footer>
      </article>

      <StoreFooter />
    </main>
  );
}
