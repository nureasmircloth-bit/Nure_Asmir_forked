import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { adminPushDevices, customerPushDevices } from "@/db/schema";
import { runInBackground } from "@/lib/background";
import { pushConfigured, sendPush, type PushPayload } from "./fcm";

const BATCH = 10;

/** Sends to many tokens, BATCH at a time, and returns the ones FCM says are permanently gone. */
async function fanOut(tokens: string[], payload: PushPayload): Promise<string[]> {
  const dead: string[] = [];
  for (let i = 0; i < tokens.length; i += BATCH) {
    const slice = tokens.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async (token) => ({ token, result: await sendPush(token, payload) })));
    for (const entry of results) if (entry.result === "dead") dead.push(entry.token);
  }
  return dead;
}

async function deliverToAdmins(payload: PushPayload): Promise<void> {
  if (!pushConfigured()) return;
  const devices = await db.select({ token: adminPushDevices.token }).from(adminPushDevices);
  if (!devices.length) return;
  const dead = await fanOut(devices.map((device) => device.token), payload);
  for (const part of chunked(dead)) await db.delete(adminPushDevices).where(inArray(adminPushDevices.token, part));
}

/** Pushes an alert to every registered admin device without delaying the request that triggered it. */
export function notifyAdmins(payload: PushPayload): void {
  runInBackground(deliverToAdmins(payload), "notifyAdmins");
}

/** Pushes to specific shopper devices (order updates, sale alerts) and prunes dead tokens. */
export async function sendToCustomerTokens(tokens: string[], payload: PushPayload): Promise<void> {
  if (!tokens.length || !pushConfigured()) return;
  const dead = await fanOut(tokens, payload);
  for (const part of chunked(dead)) await db.delete(customerPushDevices).where(inArray(customerPushDevices.token, part));
}
