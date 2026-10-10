import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "../../../_ui/ui";
import { TRAINING_URL } from "@/lib/training-host";
import { LabsView } from "./labs-view";

export const metadata = { title: "Guided labs" };

/** The list of guided labs. Lives on the training site; the real admin sends anyone who lands here to it. */
export default async function LabsPage() {
  if (process.env.APP_TARGET === "admin") redirect(`${TRAINING_URL}/admin/training/labs`);
  if (process.env.SANDBOX !== "1" && process.env.NODE_ENV === "production") notFound();
  const lang = (await cookies()).get("adm-lang")?.value === "en" ? "en" : "ur";
  return (
    <>
      <PageHeader
        title="Guided labs"
        intro={
          lang === "ur"
            ? "Chotay kaam jo aap practice shop mein khud karte hain. Har kaam ke baad lab dekh leta hai ke aap ne waqai kar liya ya nahi."
            : "Short tasks you do yourself in the practice shop. After each step the lab looks at the practice data and ticks it only when you really did it."
        }
      />
      <LabsView lang={lang} />
    </>
  );
}
