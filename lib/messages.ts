import { escapeHtml } from "@/lib/email/escape";

/** Ready-made replies the owner can start from. {name} and {order} are filled in for one customer; the owner can change every word. */
export type MessagePreset = { id: string; label: string; subject: string; body: string };

export const MESSAGE_PRESETS: MessagePreset[] = [
  {
    id: "thanks",
    label: "Thank you for your order",
    subject: "Thank you for your order {order}",
    body: "Assalam o Alaikum {name},\n\nThank you for shopping with Nure Asmir. Your order {order} is being prepared and we will let you know as soon as it is on its way.\n\nIf you need anything, just reply to this message or WhatsApp us.",
  },
  {
    id: "confirm",
    label: "Please confirm your order",
    subject: "Please confirm your order {order}",
    body: "Assalam o Alaikum {name},\n\nWe tried to reach you about your order {order}. Please confirm it by replying here or on WhatsApp so we can send it out. Your pieces are held for you for a few hours only.",
  },
  {
    id: "size",
    label: "Help with size",
    subject: "About the size of your order {order}",
    body: "Assalam o Alaikum {name},\n\nBefore we send your order {order}, we wanted to make sure the sizes are right. Please tell us your chest and waist measurements (in inches) and we will check them for you. Exchanges are easy, but we would love to get it right the first time.",
  },
  {
    id: "delay",
    label: "Sorry, a small delay",
    subject: "A small delay on your order {order}",
    body: "Assalam o Alaikum {name},\n\nWe are sorry — your order {order} will reach you a little later than planned. We are on it and will message you the moment it is on its way. Thank you for your patience.",
  },
  {
    id: "stock",
    label: "Item is out of stock",
    subject: "About your order {order}",
    body: "Assalam o Alaikum {name},\n\nWe are sorry, one piece in your order {order} has just sold out. We can send the rest now, swap it for another size or colour, or cancel that piece with a full refund. Please tell us what you prefer.",
  },
];

export function fillPreset(text: string, values: { name?: string; order?: string }): string {
  const order = values.order?.trim();
  // with no order number, " {order}" disappears together with its space, so the sentence still reads well
  return text.replaceAll("{name}", values.name?.trim() || "there").replaceAll(order ? "{order}" : " {order}", order || "");
}

/** Plain text → branded HTML. Every character the owner types is escaped; blank lines become paragraphs. */
export function customEmailHtml(input: { subject: string; body: string; buttonLabel?: string; buttonUrl?: string; unsubscribeUrl?: string }): string {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="color:#444;line-height:1.75;margin:0 0 16px;">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button =
    input.buttonLabel && input.buttonUrl && /^https?:\/\//i.test(input.buttonUrl)
      ? `<p style="margin:24px 0;"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;padding:13px 24px;background:#111;color:#fff;text-decoration:none;letter-spacing:.14em;font-size:12px;text-transform:uppercase;">${escapeHtml(input.buttonLabel)}</a></p>`
      : "";
  const unsubscribe = input.unsubscribeUrl
    ? `<p style="margin-top:28px;color:#999;font-size:12px;">You are receiving this because you joined our email list. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#999;">Unsubscribe</a></p>`
    : "";
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#111;">
    <h1 style="font-weight:500;font-size:24px;letter-spacing:.02em;margin:0 0 18px;">${escapeHtml(input.subject)}</h1>
    ${paragraphs}
    ${button}
    <p style="margin-top:40px;color:#999;font-size:12px;letter-spacing:.1em;text-transform:uppercase;">Nure Asmir</p>
    ${unsubscribe}
  </div>`;
}
