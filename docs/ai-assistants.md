# AI assistants (MCP) – connecting Claude, Gemini and others to the shop

An AI assistant can look at the shop and answer questions: which sizes are running out, what a product costs, what sold this week.
Unless you give it the “Add new products” permission it can only **look**; with that permission it can also add new products as **hidden drafts** (see “Adding products” below). It cannot change a price, a stock number, a product or an order, and it never sees customer names, phone numbers, e-mails or addresses.

The connection is an **MCP server** (Model Context Protocol, plain HTTP) on the admin site:

```
POST https://admin.nureasmir.com/api/admin/mcp
Authorization: Bearer na_mcp_…
```

## 1. Make a token (the owner)

1. Sign in to the admin and open **Settings → AI assistants**.
2. Press **Give access to an assistant**.
3. Give it a name you will recognise (“Claude on my laptop”), tick what it may look at, and choose how long it works (1 hour, 8 hours, 24 hours or 7 days). Short is safer.
4. Press **Make the token**. The token (it starts with `na_mcp_`) is shown **once**: copy it now. Only a one-way hash is kept, so it cannot be shown again. If it is lost, switch it off and make a new one.

| Tick | The assistant may |
|---|---|
| See products, sizes, prices, stock and categories | `search_products`, `get_product`, `list_categories`, `low_stock`, `products_waiting_for_pictures` |
| See sales totals and order counts | `sales_summary` (totals only, no customer details) |
| Add new products as hidden drafts | `prepare_products`, `create_products` |

Only the owner can make tokens, at most 10 can be in use at once, and each token may make 60 requests a minute.

## 2. Connect the assistant

The box that shows the new token has buttons that copy the exact lines below with the real token in them. The lines here show where the token goes.

### Claude Code

```bash
claude mcp add --transport http nure-asmir https://admin.nureasmir.com/api/admin/mcp --header "Authorization: Bearer PASTE_YOUR_TOKEN_HERE"
```

Start `claude`, type `/mcp`: “nure-asmir” should say *connected*.

### Gemini CLI

Put this in `.gemini/settings.json` (user folder or project folder). If “mcpServers” is already there, add only the “nure-asmir” part:

```json
{
  "mcpServers": {
    "nure-asmir": {
      "httpUrl": "https://admin.nureasmir.com/api/admin/mcp",
      "headers": { "Authorization": "Bearer PASTE_YOUR_TOKEN_HERE" }
    }
  }
}
```

Start Gemini CLI again and type `/mcp`.

### Cursor, VS Code and other tools

Add an MCP server of the kind **HTTP** (“streamable HTTP”, not stdio) with the address above and the header `Authorization: Bearer <token>`:

```json
{
  "mcpServers": {
    "nure-asmir": {
      "url": "https://admin.nureasmir.com/api/admin/mcp",
      "headers": { "Authorization": "Bearer PASTE_YOUR_TOKEN_HERE" }
    }
  }
}
```

### Claude.ai (browser), the Claude phone app, ChatGPT

These connect with a “Sign in and allow” button, not a token. That button (OAuth) is **not built yet**, so they cannot be connected today.

## 3. What to ask

- “Which shirts have only a few pieces left? Give me the product, colour and size.”
- “What are the price and the stock of FOR-132 in every size?”
- “How much did we sell in the last 14 days, day by day?”
- “List my categories and how many products are in each.”
- “Which products are still drafts and not on the website?”
- “Find the white shirts and tell me which sizes are sold out.”

Prices are in Pakistani rupees (PKR).

## 4. Adding products

Tick **Add new products as hidden drafts** when you make the token. Then tell the assistant what to add, for example:

> Add these two shirts to the shop. Slim Oxford Shirt in white and sky blue, category Shirts > Formal Shirts, sizes 14.5, 15.5, 16.5, price 7800 for the first two sizes and 8200 for the last, 3 pieces of each, article numbers AI-101 (white) and AI-102 (blue), pictures oxford-white-1.jpg, oxford-white-2.jpg and oxford-blue-1.jpg. Show me the preview first.

What happens:

1. The assistant writes the rows **like the Excel sheet** (one row for each colour; sizes, prices and stock as one value or one for each size) and calls `prepare_products`. **Nothing is saved.** It answers with a preview: each product page with its colours, the price, stock and code of every size, the new categories and the pictures to add, or the problems with the row number.
2. The assistant is told to show you the preview and ask. If you agree it calls `create_products` with the same rows and the **one-use confirmation** from the preview. The confirmation is random, belongs to that token and to exactly those rows, and works once for 30 minutes: so the preview cannot be skipped or reused, and if anything in the rows changed after the preview, nothing is saved. It cannot prove that a person read the preview: that is why everything is saved **hidden**, and nothing is on the website until you press Publish yourself.
3. The products are saved **hidden** (drafts). Nothing is on the website yet.
4. You add the pictures: **Products → Pictures for new products** (the Products page shows a notice while products wait). Drag all the pictures in at once: they are matched to the products by the file names written in the rows (capital letters and the file ending do not matter) and put on the right product and colour. A picture you do not have can be skipped (that is written to the activity log). Each picture is crossed off the waiting list by the same request that saves it, so a picture can never be saved yet still listed as missing.
5. Press **Publish** when a product has its pictures. **Publish all** publishes the ones that have pictures, except those the sheet marked “do not show yet” (publish those one by one).

Limits and safety: at most 100 products (600 rows) in one call and 4,000 products a day for all assistants together (counted atomically, so two calls at once cannot go over); products that already exist cannot be changed or deleted this way (a name or a code that is taken is reported in the preview; the same name in different categories is refused, because those colours would become one product page); every creation is written to the activity log with the token's name; the assistant never adds pictures.

## 5. If it does not work

| What you see | What to do |
|---|---|
| “This access token is not known” | The token was copied wrongly (a missing letter, a space at the end) or is from another website. Copy it again; it starts with `na_mcp_`. Or make a new one. |
| “has expired” / “switched off” | Make a new token. |
| “Too many requests” | At most 60 requests a minute. Wait a minute. |
| The assistant has no tools | Restart the assistant after adding the connection. The address must start with `https://` and end with `/api/admin/mcp`. Type `/mcp` to see the state. |
| “does not have the … permission” | Make a new token with that box ticked (for sales, the second box). |

## 6. Keeping it safe

- A token is a key: never put it in a chat, an e-mail or a screenshot.
- Use the shortest time that is enough, and press **Switch off** when you are done.
- If a token was shown anywhere it should not be, switch it off at once.
- Making and switching off a token is written to the activity log with the e-mail of the person who did it (making a token is for the owner; switching one off is recorded under whoever pressed the button). The list shows when each token was last used and how often.

## For developers

- Code: `lib/mcp/` (`protocol.ts` JSON-RPC + MCP messages, `tools.ts` the tools, `token.ts`, `auth.ts`, `rate-limit.ts`), `app/api/admin/mcp/route.ts` (the endpoint), `app/api/admin/mcp-tokens/` (make / list / switch off), `app/admin/(protected)/ai-access/` (the page). Table `mcp_tokens` (migration `0008`).
- The route is under `app/api/admin`, so it is built into the admin Worker only, never the storefront.
- Protocol: stateless JSON-RPC over `POST` (no sessions, no server-sent events); `GET` answers 405. Methods: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `prompts/list`, notifications. Versions 2025-06-18, 2025-03-26 and 2024-11-05.
- Every tool is marked `readOnlyHint`, takes validated arguments, and answers with plain text JSON (cut at 60 000 characters). Real failures are logged and not shown to the assistant.
- Adding a tool: add it to `TOOLS` in `lib/mcp/tools.ts` with a `scope`; a scope is added in `lib/mcp/token.ts`. A token without the scope never sees the tool.
- Tests: `e2e/unit/mcp.spec.ts`.
- Next: tools that change things (with a preview and a confirm step) and OAuth sign-in for Claude.ai and ChatGPT.
