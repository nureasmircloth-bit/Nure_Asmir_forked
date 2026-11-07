import { desc } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { parseScopes, tokenState } from "@/lib/mcp/token";
import { HelpBox } from "../../_ui/client";
import { PageHeader } from "../../_ui/ui";
import { AiAccessManager, type TokenRow } from "./ai-access-manager";
import { ConnectGuide } from "./connect-guide";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI assistants" };

/** Settings → AI assistants: the tokens, the dialog to make one, and the connection guide. */
export default async function AiAccessPage() {
  const rows = await db.select().from(mcpTokens).orderBy(desc(mcpTokens.createdAt)).limit(50);
  const tokens: TokenRow[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    prefix: row.tokenPrefix,
    scopes: parseScopes(row.scopes),
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
    useCount: row.useCount,
    state: tokenState(row),
  }));
  // The address an assistant sends its token to comes from the site's own settings, never from the request's Host header (which a visitor's request could set to anything).
  const origin = (process.env.NEXT_PUBLIC_ADMIN_URL || (process.env.NODE_ENV === "production" ? "https://admin.nureasmir.com" : "http://localhost:3000")).replace(/\/+$/, "");
  const endpoint = `${origin}/api/admin/mcp`;
  return (
    <>
      <PageHeader title="AI assistants" intro="Let an AI assistant such as Claude or Gemini look at your shop and answer questions: which sizes are running out, what sold this week, what a product costs." />
      <HelpBox id="ai-access">
        <ol>
          <li>Press <strong>Give access to an assistant</strong>, name it, choose what it may look at and for how long. Short is safer: you can always make a new one.</li>
          <li><strong>Copy the token</strong> that appears. It is shown only once; we keep no copy of it.</li>
          <li>In your assistant, add a connection (an “MCP server”) with the address and the token. The box that appears has the exact line to paste for Claude Code and Gemini CLI.</li>
          <li>Ask in plain words, for example “which shirts have only a few pieces left?”. The assistant can only <strong>look</strong>: it cannot change a price, a stock number or an order, and it never sees customer names, phone numbers or addresses.</li>
        </ol>
        <p>You can switch a token off at any time. Every token stops by itself when its time is up.</p>
      </HelpBox>
      <AiAccessManager initial={tokens} endpoint={endpoint} />
      <ConnectGuide endpoint={endpoint} />
    </>
  );
}
