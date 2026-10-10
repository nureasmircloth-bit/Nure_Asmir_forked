import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "../../_ui/ui";
import { TrainingView } from "./training-view";
import { isSandbox } from "@/lib/sandbox";
import { TRAINING_URL } from "@/lib/training-host";

export const metadata = { title: "Training" };

/** Renders the lessons in the selected language. They live on the training site; the real admin sends anyone who lands here to it. */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ lesson?: string }> }) {
  if (process.env.APP_TARGET === "admin") redirect(`${TRAINING_URL}/admin/training`);
  const { lesson } = await searchParams;
  const lang = (await cookies()).get("adm-lang")?.value === "en" ? "en" : "ur";
  const lab = isSandbox();
  return (
    <>
      <PageHeader
        title="Training"
        intro={lang === "ur" ? "Chotay, khud chalne wale lessons jo dikhate hain kahan click karna hai – ya likha hua guide parhein. Yahan kuch bhi asli dukaan ko nahi badalta." : "Short, self-playing lessons that show exactly where to click – or read the written guide. Nothing here changes your real shop."}
      />
      {lab && (
        <section className="a-card lab-try" style={{ marginBottom: 16 }}>
          <div className="a-card-pad" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <strong>{lang === "ur" ? "Ab khud karke seekhein" : "Now try it yourself"}</strong>
              <div className="a-muted">
                {lang === "ur"
                  ? "Guided labs aap ko ek ek kaam karwate hain aur check karte hain. Ya seedha practice shop kholein aur jo chahein karein."
                  : "Guided labs walk you through one task at a time and check your work. Or open the practice shop and try anything."}
              </div>
            </div>
            <Link className="a-btn a-btn-primary" href="/admin/training/labs">
              Guided labs
            </Link>
            <Link className="a-btn" href="/admin">
              {lang === "ur" ? "Practice shop" : "Free practice"}
            </Link>
          </div>
        </section>
      )}
      <TrainingView initialLesson={lesson} initialLang={lang} />
    </>
  );
}
