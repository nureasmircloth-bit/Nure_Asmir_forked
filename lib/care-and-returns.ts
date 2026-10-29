/**
 * The shop-wide wording for "Care instructions" and the short "Return policy" shown on every product page (and repeated in the full Returns policy).
 * A product's own care text, typed in the admin (product -> Material & care), replaces the default care list for that product.
 */
export const CARE_INTRO = "Keep your outfit looking elegant and beautiful with the right care.";

export const CARE_STEPS: ReadonlyArray<{ title: string; text: string }> = [
  { title: "Dry clean recommended", text: "Maintain the fabric's quality and finish." },
  { title: "Moderate ironing", text: "Iron at a moderate temperature to protect the fabric." },
  { title: "Avoid bleach", text: "Do not use bleach or harsh stain-removing chemicals." },
];

export const RETURN_SUMMARY =
  "Your satisfaction matters to us. If you receive a damaged, defective, or incorrect item, notify us within 48 hours of delivery. Products must remain unused, unopened, and in their original packaging. Our team will review your request and assist you accordingly.";
