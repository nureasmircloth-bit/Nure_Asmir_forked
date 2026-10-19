/**
 * A WhatsApp link that opens a chat with the shop with a message already typed (wa.me/<number>?text=...). A wa.me/message/... chat link
 * cannot carry a message, so the shop's number is preferred; the chat link (or the contact page) is the fallback.
 */
export function whatsappMessageLink(number: string | undefined | null, chatUrl: string | undefined | null, message: string): string {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits) return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  return chatUrl || "/contact";
}
