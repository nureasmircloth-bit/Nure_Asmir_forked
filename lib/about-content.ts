/**
 * The words of the "Our story" page. The owner edits them in the admin (Our story page); until then, and whenever a box is left empty,
 * these are used. Paragraphs are separated by a blank line. A paragraph that starts with "> " is shown as the large quote.
 * Links are written [text](/page) – only addresses on this website or https:// ones are turned into links.
 */
export const DEFAULT_ABOUT_HEADING = "Tradition in a modern form.";

export const DEFAULT_ABOUT_BODY = `Nure Asmir is a men's wear label from Pakistan. We design the pieces a man reaches for every day — shalwar kameez, shirts, pants and leather accessories — with one idea in mind: keep what is timeless about how we dress, and cut it for how we live now.

Our range is deliberately small. Each piece is designed to be worn often and to pair easily with the rest of your wardrobe, so nothing is added just to fill a rail.

> Style. Heritage. Confidence.

We deliver across Pakistan, with cash on delivery available, and we confirm every order by phone or WhatsApp before it is dispatched. If a piece is not right, our [returns policy](/policies/returns) explains how to exchange it. If you have a question before you buy, [write to us](/contact) — a person will answer.`;

export type StoryPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };
export type StoryBlock = { kind: "paragraph" | "quote"; parts: StoryPart[] };

const LINK = /\[([^\]\n]{1,80})\]\(([^)\s]{1,200})\)/g;
const safeHref = (href: string) => (/^\/(?!\/)/.test(href) || /^https:\/\//i.test(href) ? href : null);

function parseInline(text: string): StoryPart[] {
  const parts: StoryPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const href = safeHref(match[2]);
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push(href ? { kind: "link", text: match[1], href } : { kind: "text", text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Turns the owner's text into paragraphs and quotes. Never produces HTML, so nothing typed can inject markup. */
export function parseStory(body: string): StoryBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim().replace(/\s*\n\s*/g, " "))
    .filter(Boolean)
    .slice(0, 40)
    .map((block) => (block.startsWith("> ") ? { kind: "quote" as const, parts: parseInline(block.slice(2).trim()) } : { kind: "paragraph" as const, parts: parseInline(block) }));
}
