import { orderConfirmationEmail } from "./templates/order-confirmation";
import { bankDepositInstructionsEmail } from "./templates/bank-deposit-instructions";
import { reservationReminderEmail, type ReservationReminderPayload } from "./templates/reservation-reminder";
import { checkoutOtpEmail } from "./templates/checkout-otp";
import { ORDER_EVENT_COPY, orderStatusEmail, type OrderStatusEmailPayload } from "./templates/order-status";
import { sendMail, type Mail } from "./transport";

function fromAddress(): string {
  const name = process.env.RESEND_FROM_NAME || "Nure Asmir";
  const email = process.env.RESEND_FROM_EMAIL;
  return email ? `${name} <${email}>` : "Nure Asmir <onboarding@resend.dev>";
}

// Sending goes through lib/email/transport.ts: the provider with the most room left today is used, and if it is full or down the next
// one takes over – always from the same address, with a plain-text copy, a Reply-To and the "important" headers.
async function send(mail: Mail): Promise<boolean> {
  return sendMail(mail);
}

export type OrderEmailPayload = {
  toEmail: string;
  orderNumber: string;
  customerName: string;
  total: number;
  currency: string;
  items: Array<{ productName: string; variantName: string; quantity: number; lineTotal: number }>;
  paymentMethod: "cod" | "bank_deposit";
  bank?: { name: string; accountTitle: string; accountNumber: string; iban: string };
  whatsappNumber?: string;
};

/** Sends order confirmation (and, for bank-deposit orders, payment instructions) by email.
 * Best-effort only: failures are logged and swallowed so a Resend outage never blocks checkout. */
export async function sendOrderEmails(payload: OrderEmailPayload): Promise<void> {
  if (!payload.toEmail) return;
  await send({
    from: fromAddress(),
    to: payload.toEmail,
    subject: `Order ${payload.orderNumber} confirmed — Nure Asmir`,
    html: orderConfirmationEmail(payload),
  });
  if (payload.paymentMethod === "bank_deposit" && payload.bank) {
    await send({
      from: fromAddress(),
      to: payload.toEmail,
      subject: `Payment instructions for order ${payload.orderNumber}`,
      html: bankDepositInstructionsEmail(payload),
    });
  }
}

/** "Your order is waiting" nudge for orders still pending_confirmation as their reservation
 * window approaches expiry — see lib/orders.ts's sendReservationReminders. Best-effort, same as
 * sendOrderEmails: never throws, since a reminder failing should never block the cron job. */
export async function sendReservationReminderEmail(payload: ReservationReminderPayload): Promise<void> {
  if (!payload.toEmail) return;
  await send({
    from: fromAddress(),
    to: payload.toEmail,
    subject: `Your order ${payload.orderNumber} is waiting — Nure Asmir`,
    html: reservationReminderEmail(payload),
  });
}

/** Sends the checkout verification code. Unlike the other senders here, this one is NOT
 * best-effort: the customer has no other way to get the code, so a delivery failure has to be
 * surfaced to /api/checkout/request-otp as a real error rather than silently swallowed. Returns
 * false if Resend isn't configured, or the send is rejected or fails outright. */
export async function sendCheckoutOtpEmail(toEmail: string, code: string): Promise<boolean> {
  return send({
    from: fromAddress(),
    to: toEmail,
    subject: "Your Nure Asmir verification code",
    html: checkoutOtpEmail({ toEmail, code }),
  });
}

/** Plain operational alert to the store owner (ADMIN_EMAIL) — e.g. "an order couldn't be booked with
 * the courier automatically and needs a human". Best-effort like every other email here. */
export async function sendAdminAlertEmail(subject: string, html: string): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  await send({ from: fromAddress(), to, subject, html });
}

/** An email the owner wrote by hand in the admin ("Messages"). Returns whether a provider accepted it. */
export async function sendCustomEmail(to: string, subject: string, html: string): Promise<boolean> {
  return send({ from: fromAddress(), to, subject, html });
}

/** Lifecycle email (paid / on its way / delivered / cancelled …). Best-effort: never throws. */
export async function sendOrderStatusEmail(payload: Omit<OrderStatusEmailPayload, "whatsappNumber"> & { toEmail?: string }): Promise<void> {
  const to = payload.toEmail;
  if (!to) return;
  await send({
    from: fromAddress(),
    to,
    subject: `${ORDER_EVENT_COPY[payload.event].title} — order ${payload.orderNumber}`,
    html: orderStatusEmail(payload),
  });
}
