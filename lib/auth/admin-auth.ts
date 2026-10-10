import { redirect } from "next/navigation";
import { getSessionAdmin, type SessionAdmin } from "./session";

export async function getAdminUser(): Promise<SessionAdmin | null> {
  return getSessionAdmin();
}

/** Where a signed-out visitor is sent: the training lab has its own entrance (name + training password), the real admin its sign-in page. */
export const loginPath = () => (process.env.SANDBOX === "1" ? "/admin/training-login" : "/admin/login");

export async function requireAdminUser(returnTo = "/admin"): Promise<SessionAdmin> {
  const user = await getSessionAdmin();
  if (!user) redirect(`${loginPath()}?returnTo=${encodeURIComponent(returnTo)}`);
  return user;
}
