import { getAdminUser } from "@/lib/auth/admin-auth";
import { checkLab } from "@/lib/lab-checks";
import { isPracticeRequest } from "@/lib/practice-context";

export const dynamic = "force-dynamic";

/** "Check my work" in a guided lab: which steps of the lab are really done in the practice shop right now. */
export async function POST(request: Request) {
  if (!isPracticeRequest()) return Response.json({ error: "Not found." }, { status: 404 });
  if (!(await getAdminUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { lab?: unknown };
  const lab = typeof body.lab === "string" ? body.lab : "";
  try {
    const steps = await checkLab(lab);
    if (!steps) return Response.json({ error: "Unknown lab." }, { status: 400 });
    return Response.json({ steps });
  } catch (error) {
    console.error("lab check failed", error);
    return Response.json({ error: "Could not check right now. Please try again." }, { status: 500 });
  }
}
