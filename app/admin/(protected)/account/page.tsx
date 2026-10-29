import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/auth/admin-auth";
import { PageHeader } from "../../_ui/ui";
import { AccountForm } from "./account-form";

export const dynamic = "force-dynamic";
const MIN_PASSWORD_LENGTH = 12;

export default async function AccountPage() {
  if (process.env.SANDBOX === "1") notFound(); // the training lab has no real accounts
  const user = await requireAdminUser("/admin/account");
  return (
    <>
      <PageHeader title="Your account" intro={<>Signed in as <strong>{user.email}</strong>. Change your password here; every other device is signed out when you do.</>} />
      <section className="a-card a-card-pad">
        <h2 style={{ marginTop: 0 }}>Change password</h2>
        <AccountForm minLength={MIN_PASSWORD_LENGTH} />
      </section>
    </>
  );
}
