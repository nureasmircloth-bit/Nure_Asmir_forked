import { escapeHtml as esc } from "../escape";

export type OrderEventKind = "confirmed" | "paid" | "booked" | "shipped" | "delivered" | "cancelled" | "returned" | "refund_approved" | "refund_declined" | "refunded";

export type OrderStatusEmailPayload = {
  event: OrderEventKind;
  orderNumber: string;
  customerName: string;
  trackingNumber?: string | null;
  trackUrl: string;
  whatsappNumber?: string;
};

export const ORDER_EVENT_COPY: Record<OrderEventKind, { title: string; body: (n: string, tracking?: string | null) => string }> = {
  confirmed: { title: "Order confirmed", body: (n) => `Your order ${n} is confirmed and is being prepared.` },
  paid: { title: "Payment received", body: (n) => `We've received your payment for order ${n}. Thank you — we're preparing your parcel.` },
  booked: {
    title: "Your parcel is booked with TCS",
    body: (n, tracking) => `Order ${n} is packed and booked with TCS${tracking ? ` (tracking ${tracking})` : ""}. The rider will collect it soon — you can follow it any time.`,
  },
  shipped: {
    title: "Your order is on its way",
    body: (n, tracking) => `Order ${n} has been handed to the courier${tracking ? ` (tracking ${tracking})` : ""} and is on its way to you.`,
  },
  delivered: { title: "Order delivered", body: (n) => `Order ${n} has been delivered. We hope you love it.` },
  cancelled: { title: "Order cancelled", body: (n) => `Order ${n} has been cancelled. Any reserved items were released.` },
  returned: { title: "Order returned", body: (n) => `Order ${n} was marked as returned. Contact us if you have any questions.` },
  refund_approved: { title: "Refund approved", body: (n) => `Good news — we approved the refund for order ${n}. We will send your money shortly and let you know when it is done.` },
  refund_declined: { title: "About your refund request", body: (n) => `We could not approve the refund for order ${n}. Open your order to read why, or WhatsApp us and we will help.` },
  refunded: { title: "Your refund has been sent", body: (n) => `We have sent your refund for order ${n}. It can take a day or two to show in your account.` },
};

export function orderStatusEmail(payload: OrderStatusEmailPayload): string {
  const copy = ORDER_EVENT_COPY[payload.event];
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#111;">
    <h1 style="font-weight:500;font-size:24px;letter-spacing:.02em;">${esc(copy.title)}</h1>
    <p style="color:#555;line-height:1.7;">Hi ${esc(payload.customerName)},</p>
    <p style="color:#555;line-height:1.7;">${esc(copy.body(payload.orderNumber, payload.trackingNumber))}</p>
    <p><a href="${esc(payload.trackUrl)}" style="display:inline-block;padding:12px 22px;background:#111;color:#fff;text-decoration:none;letter-spacing:.14em;font-size:12px;text-transform:uppercase;">Track your order</a></p>
    ${payload.whatsappNumber ? `<p style="color:#555;">Questions? WhatsApp us: ${esc(payload.whatsappNumber)}</p>` : ""}
    <p style="margin-top:40px;color:#999;font-size:12px;letter-spacing:.1em;text-transform:uppercase;">Nure Asmir</p>
  </div>`;
}
