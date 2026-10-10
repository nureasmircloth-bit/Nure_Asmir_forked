import { cookies } from "next/headers";
import { destroySession } from "@/lib/auth/session";
import { LAB_COOKIE } from "@/lib/training-host";

export const dynamic = "force-dynamic";

export async function POST() {
  await destroySession();
  (await cookies()).delete(LAB_COOKIE); // (only ever set on the training lab)
  return Response.json({ ok: true });
}
