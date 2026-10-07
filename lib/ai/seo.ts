import { groqChat, groqKeys } from "@/lib/groq";

export type SeoFieldsInput = {
  name: string;
  typeLabel?: string;
  categoryName?: string;
  color?: string;
  material?: string;
  shortDescription?: string;
  description?: string;
  /** Phrases the owner wants the page to be found for (comma separated). */
  keywords?: string;
};

export type SeoFields = { seoTitle: string; seoDescription: string };

/**
 * Drafts the product's SEO title/description from whatever the admin already typed — the admin
 * never sees or edits these directly (per product decision: keep the create-product form simple).
 * Best-effort and silent: called from the product create/update routes, never blocks saving the
 * product if Groq is unavailable or misconfigured, and getProductBySlug/generateMetadata already
 * fall back to the plain name/shortDescription when these are null.
 */
export async function generateSeoFields(input: SeoFieldsInput): Promise<SeoFields | null> {
  if (!groqKeys().length) return null;

  const details = [
    input.typeLabel && `type: ${input.typeLabel}`,
    input.categoryName && `category: ${input.categoryName}`,
    input.color && `color: ${input.color}`,
    input.material && `material: ${input.material}`,
    (input.shortDescription || input.description) && `description: ${input.shortDescription || input.description}`,
    input.keywords?.trim() && `phrases to work in naturally if they fit: ${input.keywords.trim()}`,
  ]
    .filter(Boolean)
    .join(", ");

  const prompt = `Write SEO metadata for a men's wear e-commerce product page.
Product name: "${input.name}"${details ? `\nKnown details: ${details}` : ""}
Brand: Nure Asmir, a Pakistani men's wear label (shalwar kameez, shirts, pants, leather accessories) with the tagline "Tradition in a modern form", nationwide delivery in Pakistan.
Return strict JSON only, no other text, no markdown code fences: {"seoTitle": "...", "seoDescription": "..."}
- seoTitle: under 60 characters, include the product name naturally, no clickbait, no "Buy now"/"Shop now" phrasing.
- seoDescription: under 155 characters, one or two plain sentences describing the product and mentioning nationwide delivery in Pakistan, confident and understated tone, no exclamation marks, no clichés.`;

  try {
    const answer = await groqChat({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      // Deliberately no response_format: json_object – the API rejects this exact prompt/model combination (400).
      // Plain instructed-JSON output works; it is parsed defensively below in case of stray code fences.
      reasoning_effort: "low",
      max_completion_tokens: 700,
    });
    if (!answer.ok) return null;
    const content = answer.content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

    const parsed = JSON.parse(content) as { seoTitle?: unknown; seoDescription?: unknown };
    if (typeof parsed.seoTitle !== "string" || typeof parsed.seoDescription !== "string") return null;

    return {
      seoTitle: parsed.seoTitle.slice(0, 70).trim(),
      seoDescription: parsed.seoDescription.slice(0, 165).trim(),
    };
  } catch (error) {
    console.error("generateSeoFields failed", error);
    return null;
  }
}
