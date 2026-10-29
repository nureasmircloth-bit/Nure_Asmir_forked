import { requestIp } from "@/lib/auth/rate-limit";
import { verifyOtp } from "@/lib/checkout/otp";

export const dynamic = "force-dynamic";

const REASON_MESSAGES: Record<string, string> = {
  not_found: "Request a new code first.",
  expired: "That code has expired — request a new one.",
  too_many_attempts: "Too many incorrect attempts — request a new code.",
  incorrect: "That code is incorrect.",
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return Response.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  const ip = requestIp(request);
  const outcome = await verifyOtp(email, code, ip);
  if (!outcome.ok) {
    return Response.json({ error: REASON_MESSAGES[outcome.reason] ?? "Could not verify that code." }, { status: 400 });
  }

  return Response.json({ ok: true, verifiedToken: outcome.verifiedToken });
}
