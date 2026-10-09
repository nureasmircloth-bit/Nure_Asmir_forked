import { neon } from "@neondatabase/serverless";
import { requestIsPractising } from "./practice-cookie";
import { hitCountsAgainstLimit, hitState, LIMIT_REACHED_MESSAGE } from "./sandbox-rules";

/** Today's date in Pakistan, as text (the practice allowance resets at midnight there). */
const pakistanDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });

/**
 * Runs first on every request of the practice shop (called from middleware.ts). Counts the request against today's allowance and,
 * when it is used up, answers it here with a plain message instead of letting it reach the admin. Never used by the real shop.
 * If the counting itself fails (for example the database is waking up) the request is allowed through: practice should not break.
 */
export async function sandboxGate(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!hitCountsAgainstLimit(url.pathname, request.method, request.headers)) return null;
  // only a browser that is practising (or a server set to practise) is counted; the real shop is never slowed down
  if (process.env.SANDBOX !== "1" && !(await requestIsPractising(request, process.env.CRON_SECRET))) return null;
  const practiceUrl = process.env.PRACTICE_DATABASE_URL;
  if (!practiceUrl) return null;
  let used: number;
  try {
    const sql = neon(practiceUrl);
    const rows = (await sql`insert into sandbox_usage (day, hits) values (${pakistanDay()}, 1) on conflict (day) do update set hits = sandbox_usage.hits + 1 returning hits`) as Array<{ hits: number }>;
    used = Number(rows[0]?.hits ?? 0);
  } catch {
    return null;
  }
  if (!hitState(used).blocked) return null;
  if (url.pathname.startsWith("/api/")) return Response.json({ error: LIMIT_REACHED_MESSAGE }, { status: 429 });
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Practice used up for today</title>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#222;line-height:1.6">
<p style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:#8a5a00">Practice shop</p>
<h1 style="font-weight:600">That is enough practice for today</h1><p>${LIMIT_REACHED_MESSAGE}</p></body>`,
    { status: 429, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}
