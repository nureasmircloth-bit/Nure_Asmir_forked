import { sql } from "drizzle-orm";
import { db } from "@/db";
import { nowMs } from "@/db/sql-compat";
import { runInBackground } from "@/lib/background";

/**
 * Counts every request the website sends to an outside service, per service and per day (Pakistan time), so the developer page
 * can show "used today / this month" next to each free allowance. Counting never slows or breaks the real request: the write is
 * done in the background and its own failure is ignored.
 */
export type ServiceName = "algolia" | "groq" | "groq-2" | "groq-3" | "resend" | "resend-2" | "brevo" | "geoapify" | "tcs" | "fcm" | "whatsapp" | "turnstile" | "neon-storage" | "r2-storage";

/** Today's date in Pakistan (always UTC+5) as YYYY-MM-DD. */
export function pktDay(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

export async function recordApiCall(service: ServiceName, ok: boolean, error = ""): Promise<void> {
  try {
    const failed = ok ? 0 : 1;
    const message = ok ? "" : error.slice(0, 300);
    await db.execute(sql`
      insert into api_usage (service, day, calls, errors, last_error, last_at)
      values (${service}, ${pktDay()}, 1, ${failed}, ${message}, ${nowMs})
      on conflict (service, day) do update set
        calls = api_usage.calls + 1,
        errors = api_usage.errors + ${failed},
        last_error = case when ${ok ? 1 : 0} then api_usage.last_error else ${message} end,
        last_at = ${nowMs}`);
  } catch {
    // counting is best-effort
  }
}

/** Runs `job`, counts it (success or failure) and returns its result unchanged. */
export async function tracked<T>(service: ServiceName, job: () => Promise<T>): Promise<T> {
  try {
    const result = await job();
    runInBackground(recordApiCall(service, true), `usage:${service}`);
    return result;
  } catch (error) {
    runInBackground(recordApiCall(service, false, error instanceof Error ? error.message : String(error)), `usage:${service}`);
    throw error;
  }
}

/** Remembers what a service says about its own limits (they come in response headers) for the developer page. */
export async function noteLimits(service: string, values: Record<string, unknown>): Promise<void> {
  try {
    const value = JSON.stringify(values);
    await db.execute(sql`
      insert into service_stats (key, value, updated_at) values (${`limits:${service}`}, ${value}, ${nowMs})
      on conflict (key) do update set value = ${value}, updated_at = ${nowMs}`);
  } catch {
    // best-effort
  }
}

/** Header names (lower-case) that carry a service's remaining allowance, per service. */
const LIMIT_HEADERS: Partial<Record<ServiceName, string[]>> = {
  groq: ["x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-requests"],
  resend: ["x-resend-daily-quota", "x-resend-monthly-quota", "ratelimit-limit", "ratelimit-remaining"],
};

/** fetch() that also counts the request (HTTP errors count as failures) and keeps any limit headers the service returned. */
export async function trackedFetch(service: ServiceName, input: string | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    runInBackground(recordApiCall(service, false, error instanceof Error ? error.message : String(error)), `usage:${service}`);
    throw error;
  }
  runInBackground(recordApiCall(service, response.ok, response.ok ? "" : `HTTP ${response.status}`), `usage:${service}`);
  const wanted = LIMIT_HEADERS[service];
  if (wanted) {
    const found: Record<string, unknown> = {};
    for (const name of wanted) {
      const value = response.headers.get(name);
      if (value !== null) found[name] = value;
    }
    if (Object.keys(found).length) runInBackground(noteLimits(service, found), `limits:${service}`);
  }
  return response;
}

/** Wraps an SDK client so every method call is counted for `service` (used for Algolia and Resend, which are not plain fetch calls). */
export function counted<T extends object>(service: ServiceName, client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return (result as Promise<unknown>).then(
            (ok) => {
              runInBackground(recordApiCall(service, true), `usage:${service}`);
              return ok;
            },
            (error) => {
              runInBackground(recordApiCall(service, false, error instanceof Error ? error.message : String(error)), `usage:${service}`);
              throw error;
            },
          );
        }
        return result;
      };
    },
  });
}
