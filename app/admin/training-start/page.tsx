import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAdminUser } from "@/lib/auth/admin-auth";
import { isPracticeRequest } from "@/lib/practice-context";
import { LAB_COOKIE } from "@/lib/training-host";
import { sandboxHits } from "@/lib/sandbox";
import { LabStart } from "./lab-start";

export const dynamic = "force-dynamic";
export const metadata = { title: "Start your lab" };

/** The step between signing in and the lab: nothing opens until the trainee presses "Start my lab" and the 10-second get-ready is over. */
export default async function TrainingStartPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; again?: string }> }) {
  if (!isPracticeRequest()) notFound();
  const { returnTo: requested, again } = await searchParams;
  const user = await requireAdminUser("/admin/training-start");
  const returnTo = requested && requested.startsWith("/admin") && !requested.startsWith("//") ? requested : "/admin/training";
  if (!again && (await cookies()).get(LAB_COOKIE)?.value) redirect(returnTo);
  const hits = await sandboxHits();
  return <LabStart name={user.displayName ?? "there"} returnTo={returnTo} clicksLeft={hits.left} limit={hits.limit} />;
}
