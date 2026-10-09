import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth/admin-auth";
import { isSandbox, practiceAvailable, SANDBOX_LIMITS } from "@/lib/sandbox";
import { PageHeader } from "../../_ui/ui";
import { PracticeStart } from "./practice-start";

export const dynamic = "force-dynamic";
export const metadata = { title: "Practice shop" };

export default async function PracticePage() {
  const user = await requireAdminUser("/admin/practice");
  if (isSandbox()) redirect("/admin");
  return (
    <>
      <PageHeader title="Practice shop" intro="The same screens as your real admin, filled with pretend products and orders. Click anything: nothing you do here reaches a customer or changes your real shop." />
      {practiceAvailable() && user.role === "owner" ? (
        <PracticeStart limit={SANDBOX_LIMITS.hitsPerDay} />
      ) : (
        <section className="a-card">
          <div className="a-card-pad">The practice shop is not switched on yet. Please ask your developer.</div>
        </section>
      )}
    </>
  );
}
