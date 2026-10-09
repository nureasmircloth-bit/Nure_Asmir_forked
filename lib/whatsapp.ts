import { isPracticeRequest } from "@/lib/practice-context";
import { trackedFetch } from "@/lib/usage";
const GRAPH_VERSION = "v21.0";

/** Normalizes a Pakistani number to the digits-only international format WhatsApp's API requires
 * (e.g. "923001234567", no "+", no leading "0"). Checkout accepts free-text phone entry — customers
 * type "0300...", "+92300...", "92300..." interchangeably — so this can't assume any one shape. */
export function toWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  return `92${digits}`;
}

/**
 * Sends the order-confirmation template (with Confirm/Cancel quick-reply buttons) via the
 * WhatsApp Business Platform (Cloud API). Best-effort, matching every other optional integration
 * in this codebase (Resend, Turnstile, GROQ): returns null and no-ops rather than throwing when
 * WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID aren't configured yet, so checkout never fails
 * because of this.
 *
 * Returns the WhatsApp message ID on success — the caller stores it on the order row
 * (orders.whatsappMessageId) so a later Confirm/Cancel button tap can be matched back to this
 * specific order (see app/api/whatsapp/webhook/route.ts).
 *
 * The template's exact body-parameter count/order and button payload strings must match what was
 * actually approved in Meta's console — see the setup notes wherever this is called from.
 */
export async function sendOrderConfirmationWhatsApp(params: {
  toPhone: string; // E.164 without '+', e.g. "923001234567"
  customerName: string;
  orderNumber: string;
  total: number;
}): Promise<string | null> {
  const accessToken = isPracticeRequest() ? undefined : process.env.WHATSAPP_ACCESS_TOKEN; // (never in the practice shop)
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || "order_confirmation";
  if (!accessToken || !phoneNumberId) return null;

  try {
    const response = await trackedFetch("whatsapp", `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.toPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              // The approved template uses named variables ({{customer_name}}, {{order_id}},
              // {{order_amount}}), not positional ({{1}}, {{2}}, {{3}}) — named-variable templates
              // require each parameter to carry a matching parameter_name, or Meta rejects the send.
              parameters: [
                { type: "text", parameter_name: "customer_name", text: params.customerName },
                { type: "text", parameter_name: "order_id", text: params.orderNumber },
                { type: "text", parameter_name: "order_amount", text: `PKR ${params.total.toLocaleString("en-PK")}` },
              ],
            },
          ],
        },
      }),
    });
    const data = (await response.json().catch(() => null)) as { messages?: [{ id?: string }]; error?: unknown } | null;
    if (!response.ok || !data?.messages?.[0]?.id) {
      console.error("WhatsApp order-confirmation send failed", data?.error ?? (await response.text().catch(() => response.statusText)));
      return null;
    }
    return data.messages[0].id;
  } catch (error) {
    console.error("WhatsApp order-confirmation send failed", error);
    return null;
  }
}

/**
 * Sends a plain free-text WhatsApp message — used for the Confirm/Cancel acknowledgement reply
 * (see app/api/whatsapp/webhook/route.ts). Unlike sendOrderConfirmationWhatsApp, this doesn't need
 * an approved template: the customer's own button tap just opened WhatsApp's 24-hour customer-
 * service session, and free-form text is allowed within that window.
 */
export async function sendWhatsAppText(toPhone: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const accessToken = isPracticeRequest() ? undefined : process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set" };

  try {
    const response = await trackedFetch("whatsapp", `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: text },
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => response.statusText);
      console.error("WhatsApp text send failed", errorBody);
      return { ok: false, error: `HTTP ${response.status}: ${errorBody}` };
    }
    return { ok: true };
  } catch (error) {
    console.error("WhatsApp text send failed", error);
    return { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}
