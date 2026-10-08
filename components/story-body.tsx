import Link from "next/link";
import { parseStory, type StoryPart } from "@/lib/about-content";

function Parts({ parts }: { parts: StoryPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : part.href.startsWith("/") ? (
          <Link key={index} href={part.href}>
            {part.text}
          </Link>
        ) : (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ),
      )}
    </>
  );
}

/** The paragraphs and quotes of the "Our story" page. Shared by the website and by the preview in the admin. */
export function StoryBody({ body }: { body: string }) {
  return (
    <>
      {parseStory(body).map((block, index) =>
        block.kind === "quote" ? (
          <blockquote key={index}>
            <Parts parts={block.parts} />
          </blockquote>
        ) : (
          <p key={index}>
            <Parts parts={block.parts} />
          </p>
        ),
      )}
    </>
  );
}
