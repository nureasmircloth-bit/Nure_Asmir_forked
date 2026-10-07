import { z } from "zod";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { generateSeoFields } from "@/lib/ai/seo";
import { groqKeys } from "@/lib/groq";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.string().max(80).optional(),
  category: z.string().max(80).optional(),
  color: z.string().max(200).optional(),
  material: z.string().max(120).optional(),
  shortDescription: z.string().max(600).optional(),
  description: z.string().max(2000).optional(),
  keywords: z.string().max(500).optional(),
});

/** Drafts the Google title and the two-line description for one product (the owner reads and edits it before saving). */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!groqKeys().length) return Response.json({ error: "The writing helper isn't switched on yet. You can type the Google text yourself." }, { status: 501 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Please type the product name first." }, { status: 400 });
  const { name, type, category, color, material, shortDescription, description, keywords } = parsed.data;

  const fields = await generateSeoFields({ name, typeLabel: type, categoryName: category, color, material, shortDescription, description, keywords });
  if (!fields) return Response.json({ error: "The writing helper is busy right now. Please try again in a minute – or type the text yourself." }, { status: 502 });
  return Response.json(fields);
}
