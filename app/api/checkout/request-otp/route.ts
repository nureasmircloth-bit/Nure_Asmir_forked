import { requestOtp } from "@/lib/checkout/otp";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendCheckoutOtpEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/; // dots are excluded from the label parts so the pattern cannot backtrack badly

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const humanVerified = await verifyTurnstileToken(turnstileToken, ip);
  if (!humanVerified) {
    return Response.json({ error: "Verification failed — please try again." }, { status: 400 });
  }

  const outcome = await requestOtp(email, ip);
  if (!outcome.ok) {
    if (outcome.reason === "cooldown") {
      return Response.json({ error: `Please wait ${outcome.retryAfterSeconds}s before requesting another code.` }, { status: 429 });
    }
    return Response.json({ error: "Too many code requests — please try again later." }, { status: 429 });
  }

  const sent = await sendCheckoutOtpEmail(email, outcome.code);
  if (!sent) {
    return Response.json({ error: "Could not send the verification email — please try again in a moment." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
