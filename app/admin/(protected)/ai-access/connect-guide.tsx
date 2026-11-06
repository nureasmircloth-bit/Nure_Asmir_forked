// Step-by-step help for connecting an assistant, written for the shop owner. The address is this admin site's own; the token is a stand-in because a token is only
// shown once, when it is made (that box has the exact lines with the real token in them, ready to copy).

const SHELL = { margin: "8px 0 0", padding: "12px 14px", background: "var(--surface-2, rgba(127,127,127,.12))", border: "1px solid var(--line)", borderRadius: 8, overflowX: "auto", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all" } as const;
const BOX = { border: "1px solid var(--line)", borderRadius: 10, padding: "12px 16px" } as const;
const SUMMARY = { cursor: "pointer", fontWeight: 600 } as const;

function Code({ children }: { children: string }) {
  return <pre style={SHELL}><code>{children}</code></pre>;
}

const QUESTIONS = [
  "Which shirts have only a few pieces left? Give me the product, colour and size.",
  "What are the price and the stock of FOR-132 in every size?",
  "How much did we sell in the last 14 days, day by day?",
  "List my categories and how many products are in each.",
  "Which products are still drafts and not on the website?",
  "Find the white shirts and tell me which sizes are sold out.",
];

const TROUBLE: Array<[string, string]> = [
  ["“This access token is not known”", "The token was copied wrongly (a missing letter, or a space at the end) or belongs to another website. Copy it again; it starts with na_mcp_. If you cannot, make a new one."],
  ["“This access token has expired” / “switched off”", "Its time is up, or you switched it off. Make a new token here and paste it in place of the old one."],
  ["“Too many requests”", "An assistant may ask at most 60 times a minute. Wait a minute and ask again."],
  ["The assistant says it has no tools, or cannot find the shop", "Close and open the assistant again after adding the connection. Check that the address ends with /api/admin/mcp and starts with https://. In Claude Code and Gemini CLI, type /mcp to see whether “nure-asmir” is connected."],
  ["“This access token does not have the … permission”", "The token was made without that box ticked (for example the sales box). Make a new token with the box ticked."],
  ["The sales question is not answered", "Sales totals need the second box (“See sales totals and order counts”) when you make the token."],
];

export function ConnectGuide({ endpoint }: { endpoint: string }) {
  const claudeCode = `claude mcp add --transport http nure-asmir ${endpoint} --header "Authorization: Bearer PASTE_YOUR_TOKEN_HERE"`;
  const gemini = JSON.stringify({ mcpServers: { "nure-asmir": { httpUrl: endpoint, headers: { Authorization: "Bearer PASTE_YOUR_TOKEN_HERE" } } } }, null, 2);
  const generic = JSON.stringify({ mcpServers: { "nure-asmir": { url: endpoint, headers: { Authorization: "Bearer PASTE_YOUR_TOKEN_HERE" } } } }, null, 2);

  return (
    <section className="a-card a-card-pad a-stack" style={{ gap: 12 }} aria-labelledby="connect-title">
      <h2 id="connect-title" style={{ fontSize: 17, margin: 0 }}>How to connect an assistant</h2>
      <p className="a-muted" style={{ margin: 0 }}>
        Make a token above first. You need two things in the assistant: the <strong>address</strong> <code>{endpoint}</code> and the <strong>token</strong>. After you make a token, the box that shows it has these lines
        ready to copy with the token already in them; the examples below only show where the token goes.
      </p>

      <details style={BOX} open>
        <summary style={SUMMARY}>Claude Code (the terminal program)</summary>
        <ol style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li>Make a token, press <strong>Copy the line for Claude Code</strong>, paste it in a terminal and press Enter. It looks like this:</li>
        </ol>
        <Code>{claudeCode}</Code>
        <ol start={2} style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li>Start Claude Code (<code>claude</code>) and type <code>/mcp</code>. “nure-asmir” should say <em>connected</em>.</li>
          <li>Ask a question in your own words (examples below).</li>
        </ol>
      </details>

      <details style={BOX}>
        <summary style={SUMMARY}>Gemini CLI</summary>
        <ol style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li>Make a token and press <strong>Copy the settings for Gemini CLI</strong>.</li>
          <li>Open the file <code>.gemini/settings.json</code> (in your user folder, or in the folder you work in) and put this in it. If the file already has “mcpServers”, add only the “nure-asmir” part inside it:</li>
        </ol>
        <Code>{gemini}</Code>
        <ol start={3} style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li>Start Gemini CLI again and type <code>/mcp</code> to see the connection, then ask your question.</li>
        </ol>
      </details>

      <details style={BOX}>
        <summary style={SUMMARY}>Cursor, VS Code and other tools that take an “MCP server”</summary>
        <p style={{ margin: "10px 0 0" }}>Most of them have a settings file or a screen where you add a server with an <strong>address</strong> and <strong>headers</strong>. Use the address above and the header <code>Authorization</code> with the value <code>Bearer</code>, a space, and your token. As a file it usually looks like this:</p>
        <Code>{generic}</Code>
        <p className="a-muted" style={{ margin: "8px 0 0" }}>Choose the kind “HTTP” (also called “streamable HTTP”), not “stdio”.</p>
      </details>

      <details style={BOX}>
        <summary style={SUMMARY}>Claude.ai in the browser, the Claude phone app and ChatGPT</summary>
        <p style={{ margin: "10px 0 0" }}>These connect with a “Sign in and allow” button instead of a token. That button is <strong>not made yet</strong>, so they cannot be connected today. It comes in a later step; this page will then say so.</p>
      </details>

      <details style={BOX}>
        <summary style={SUMMARY}>What to ask</summary>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          {QUESTIONS.map((question) => <li key={question}>“{question}”</li>)}
        </ul>
        <p className="a-muted" style={{ margin: "8px 0 0" }}>The assistant can only look. It cannot change a price, a stock number, a product or an order, and it never sees customer names, phone numbers or addresses. Prices are in rupees.</p>
      </details>

      <details style={BOX}>
        <summary style={SUMMARY}>If it does not work</summary>
        <dl style={{ margin: "10px 0 0" }}>
          {TROUBLE.map(([problem, fix]) => (
            <div key={problem} style={{ marginBottom: 10 }}>
              <dt style={{ fontWeight: 600 }}>{problem}</dt>
              <dd style={{ margin: "2px 0 0" }}>{fix}</dd>
            </div>
          ))}
        </dl>
      </details>

      <details style={BOX}>
        <summary style={SUMMARY}>Keeping it safe</summary>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          <li>A token is like a key. Do not send it in a chat, an e-mail or a screenshot. Anyone who has it can look at your products and sales until it expires.</li>
          <li>Choose the shortest time that is enough (1 hour is plenty for a question or two). When you are done, press <strong>Switch off</strong>.</li>
          <li>If a token is shown anywhere it should not be, switch it off here at once and make a new one.</li>
          <li>Every token you make or switch off is written in the activity log with your name.</li>
        </ul>
      </details>
    </section>
  );
}
