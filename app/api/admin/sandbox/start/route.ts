import { cookies } from "next/headers";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { LAB_COOKIE, LAB_COOKIE_HOURS } from "@/lib/training-host";
import { isPracticeRequest } from "@/lib/practice-context";
import { hasBaseline, resetToBaseline } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

/**
 * "Start my lab" and "Start again": puts every practice table back to its starting data (sign-ins stay), and marks this browser's lab
 * as started. One lab is shared by everyone who has the training password, so starting again resets it for all of them.
 */
export async function POST() {
  if (!isPracticeRequest()) return Response.json({ error: "Not found." }, { status: 404 });
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (!(await hasBaseline())) return Response.json({ error: "The lab's starting data has not been set up yet. Please ask your developer." }, { status: 503 });
    await resetToBaseline();
  } catch (error) {
    console.error("training lab start failed", error);
    return Response.json({ error: "The lab could not be made ready. Please try again in a minute." }, { status: 500 });
  }
  (await cookies()).set(LAB_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: LAB_COOKIE_HOURS * 3600 });
  return Response.json({ ok: true });
}
