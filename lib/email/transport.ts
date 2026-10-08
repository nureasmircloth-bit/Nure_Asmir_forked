import { sql } from "drizzle-orm";
import { db } from "@/db";
import { SERVICES } from "@/lib/dev-limits";
import { pktDay, trackedFetch, type ServiceName } from "@/lib/usage";

/**
 * Sends one email through whichever configured provider has the most room left today, and moves on to the next provider if one is
 * full or down – the customer's email still goes out, and always from the same address.
 *
 * Providers (all optional except the first): Resend (RESEND_API_KEY), a second Resend account (RESEND_API_KEY_2) and Brevo
 * (BREVO_API_KEY, 300 a day free). Every provider must have the shop's domain verified and the same From address allowed.
 */
export type Mail = { from: string; to: string; subject: string; html: string };

type Provider = { service: ServiceName; configured: () => boolean; send: (mail: Mail, extra: Extra) => Promise<Response> };
type Extra = { text: string; replyTo?: string; headers: Record<string, string> };

/** "Nure Asmir <orders@nureasmir.com>" → { name, email } */
export function splitFrom(from: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1].replace(/^"|"$/g, ""), email: match[2] } : { name: "", email: from.trim() };
}

/** A readable plain-text copy of an HTML email. Mail with both a text and an HTML part is trusted more by spam filters. */
export function htmlToText(html: string): string {
  const entities: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", "#39": "'", apos: "'", quot: '"' };
  // keep removing until nothing is left to remove, so a tag hidden inside another one ("<scr<b>ipt>") cannot survive a single pass
  const strip = (text: string, pattern: RegExp) => {
    let previous: string;
    do {
      previous = text;
      text = text.replace(pattern, "");
    } while (text !== previous);
    return text;
  };
  const withoutCode = strip(html, /<(style|script)[\s\S]*?<\/\1>/gi);
  const withLinks = withoutCode
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)");
  return (
    strip(withLinks, /<[^>]+>/g)
      // every entity is decoded in one pass: decoding "&amp;" first and "&lt;" afterwards would turn "&amp;lt;" into "<" (double unescaping)
      .replace(/&(nbsp|amp|lt|gt|#39|apos|quot);/g, (_whole, name: string) => entities[name])
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Headers that mark a message as an important, expected one-to-one message (Outlook and Apple Mail show the flag; Gmail decides for itself). */
export const IMPORTANT_HEADERS: Record<string, string> = { Importance: "high", "X-Priority": "1", "X-MSMail-Priority": "High" };

const resend = (service: "resend" | "resend-2", envName: string): Provider => ({
  service,
  configured: () => Boolean(process.env[envName]),
  send: (mail, extra) =>
    trackedFetch(service, "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env[envName]}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, html: mail.html, text: extra.text, reply_to: extra.replyTo, headers: extra.headers }),
      signal: AbortSignal.timeout(15_000),
    }),
});

const brevo: Provider = {
  service: "brevo",
  configured: () => Boolean(process.env.BREVO_API_KEY),
  send: (mail, extra) => {
    const sender = splitFrom(mail.from);
    return trackedFetch("brevo", "https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY as string, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender, to: [{ email: mail.to }], subject: mail.subject, htmlContent: mail.html, textContent: extra.text, ...(extra.replyTo ? { replyTo: { email: extra.replyTo } } : {}), headers: extra.headers }),
      signal: AbortSignal.timeout(15_000),
    });
  },
};

const PROVIDERS: Provider[] = [resend("resend", "RESEND_API_KEY"), resend("resend-2", "RESEND_API_KEY_2"), brevo];

async function usedToday(services: ServiceName[]): Promise<Map<ServiceName, number>> {
  try {
    const result = (await db.execute(sql`select service, calls from api_usage where day = ${pktDay()}::date and service in (${sql.join(services.map((s) => sql`${s}`), sql`, `)})`)) as unknown as { rows: Array<{ service: ServiceName; calls: number }> };
    return new Map((result.rows ?? []).map((row) => [row.service, Number(row.calls)]));
  } catch {
    return new Map();
  }
}

/** Providers to try, fullest-last. Pure so it can be tested: ratio of today's use to the daily allowance. */
export function orderProviders<T extends { service: ServiceName }>(providers: T[], used: Map<ServiceName, number>): T[] {
  const ratio = (service: ServiceName) => {
    const limit = SERVICES[service].limit;
    return limit ? (used.get(service) ?? 0) / limit : 0;
  };
  return [...providers].sort((a, b) => ratio(a.service) - ratio(b.service) || PROVIDERS.findIndex((p) => p.service === a.service) - PROVIDERS.findIndex((p) => p.service === b.service));
}

/** Failures worth trying another provider for: out of allowance, a bad key, or the provider being down. Anything else (bad address) would fail everywhere. */
export const shouldFailOver = (status: number) => status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;

/** How many emails can still go out today across every configured provider (their free daily allowances, minus what was already sent). */
export async function emailAllowance(): Promise<{ limit: number; used: number; left: number; providers: number }> {
  const ready = PROVIDERS.filter((provider) => provider.configured());
  if (!ready.length) return { limit: 0, used: 0, left: 0, providers: 0 };
  const used = await usedToday(ready.map((provider) => provider.service));
  const limit = ready.reduce((sum, provider) => sum + (SERVICES[provider.service].limit ?? 0), 0);
  const spent = ready.reduce((sum, provider) => sum + (used.get(provider.service) ?? 0), 0);
  return { limit, used: spent, left: Math.max(0, limit - spent), providers: ready.length };
}

export async function sendMail(mail: Mail): Promise<boolean> {
  const ready = PROVIDERS.filter((provider) => provider.configured());
  if (!ready.length) return false;
  const replyTo = process.env.EMAIL_REPLY_TO || process.env.RESEND_FROM_EMAIL || undefined;
  const extra: Extra = { text: htmlToText(mail.html), replyTo, headers: { ...IMPORTANT_HEADERS } };
  const ordered = ready.length > 1 ? orderProviders(ready, await usedToday(ready.map((p) => p.service))) : ready;

  for (const provider of ordered) {
    try {
      const response = await provider.send(mail, extra);
      if (response.ok) return true;
      console.error(`Email via ${provider.service} rejected: ${response.status}`);
      if (!shouldFailOver(response.status)) return false;
    } catch (error) {
      console.error(`Email via ${provider.service} failed`, error);
    }
  }
  return false;
}
