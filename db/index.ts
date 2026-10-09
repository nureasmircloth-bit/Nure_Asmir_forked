import { neon, neonConfig, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;
import { drizzle } from "drizzle-orm/neon-http";
import { isPracticeRequest } from "../lib/practice-context";
import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon Postgres connection string.",
    );
  }
  return url;
}

// IMPORTANT: this MUST stay the stateless, per-query HTTP driver (fetch-based), not the
// Pool-based `neon-serverless` driver. Cloudflare Workers forbids reusing an I/O object (sockets,
// streams, etc.) across different requests — each request gets its own isolated I/O context, even
// when the same Worker isolate handles multiple requests over time. A WebSocket connection pool is
// exactly this kind of long-lived cross-request state, and using one here caused real, reproduced
// production failures: "Cannot perform I/O on behalf of a different request" and "Network
// connection lost" errors surfacing as intermittent Error 1101s on every route. `neon-http` issues
// a fresh, independent fetch() per query, so nothing is ever held open between requests.
//
// The tradeoff: this driver does not support `db.transaction(async (tx) => {...})` — it throws
// "No transactions support in neon-http driver" if called. Multi-statement writes that need
// atomicity (order creation, reservation expiry) use guarded sequential awaits instead — see
// app/api/orders/route.ts and lib/orders.ts for the pattern (a conditional UPDATE with a WHERE
// guard acts as the atomicity check, since Postgres itself still applies each statement safely).
// Retry only failures that happen BEFORE a request could have reached Neon (DNS / refused / connect
// timeout). Those are safe to repeat even for writes; anything else (a reset after sending, an HTTP
// error) is surfaced untouched so a write is never executed twice.
const CONNECT_PHASE_ERRORS = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ENETUNREACH"]);
neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code ?? "";
      if (attempt >= 3 || !CONNECT_PHASE_ERRORS.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
};

const realSql = neon(requireDatabaseUrl());

// The PRACTICE tables: the same tables again, in a schema called "practice" that only the practice database user can see (its
// search_path is "practice" and it has no rights on the real tables). `db` quietly points at them while the request being handled
// is a practice request (lib/practice-context.ts), and at the real tables otherwise – so every screen of the admin works unchanged.
let practiceSql: Sql | null = null;
function practiceClient(): Sql {
  const url = process.env.PRACTICE_DATABASE_URL;
  if (!url) throw new Error("The practice shop is not set up (PRACTICE_DATABASE_URL is missing).");
  return (practiceSql ??= neon(url));
}
const current = (): Sql => (isPracticeRequest() ? practiceClient() : realSql);
const switching = ((...args: unknown[]) => (current() as unknown as (...a: unknown[]) => unknown)(...args)) as unknown as Sql;
Object.assign(switching, {
  query: (...args: unknown[]) => (current().query as unknown as (...a: unknown[]) => unknown)(...args),
  transaction: (...args: unknown[]) => (current().transaction as unknown as (...a: unknown[]) => unknown)(...args),
});

export const db = drizzle(switching, { schema });
/** Always the practice tables, whatever the current request is (used to set practice up, reset it and count its clicks). */
export const practiceDb = () => drizzle(practiceClient(), { schema });
export { schema };
