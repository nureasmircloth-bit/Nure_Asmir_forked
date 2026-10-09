import { isPracticeRequest } from "@/lib/practice-context";
import { trackedFetch } from "@/lib/usage";
// TCS (Pakistani courier) E-COM API client — see "TCS API User Guide v1.0" (envio.tcscourier.com).
//
// Everything here is server-only: the account credentials never reach the browser. Like the other optional
// integrations (WhatsApp, Resend, Turnstile) it is inert until configured: with TCS_USERNAME / TCS_PASSWORD /
// TCS_ACCOUNT_NO / TCS_COST_CENTER_CODE unset, isTcsConfigured() is false and the admin simply offers
// "I booked it on the TCS website – save the tracking number" instead of one-click booking.
//
// TCS gives a merchant a sandbox first (devconnect) and enables production (ociconnect) after UAT; set
// TCS_ENV=production only after that. TCS_BASE_URL overrides both (used by the e2e mock server).

const TIMEOUT_MS = 20_000;

export function tcsBaseUrl(): string {
  if (process.env.TCS_BASE_URL) return process.env.TCS_BASE_URL.replace(/\/$/, "");
  return process.env.TCS_ENV === "production" ? "https://ociconnect.tcscourier.com" : "https://devconnect.tcscourier.com";
}

export function isTcsConfigured(): boolean {
  if (isPracticeRequest()) return false; // the practice shop never talks to TCS
  return Boolean(process.env.TCS_USERNAME && process.env.TCS_PASSWORD && process.env.TCS_ACCOUNT_NO && process.env.TCS_COST_CENTER_CODE);
}

export class TcsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TcsError";
  }
}

/** True for failures worth retrying later (TCS unreachable, timing out, or a 5xx) as opposed to ones that
 * will fail identically every time (bad city, invalid phone, rejected payload). */
export function isRetryableTcsError(error: unknown): boolean {
  if (!(error instanceof TcsError)) return true;
  return error.status === undefined || error.status >= 500;
}

async function rawFetch(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { token, ...rest } = init;
    return await trackedFetch("tcs", `${tcsBaseUrl()}${path}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new TcsError("TCS did not respond in time. Please try again.");
    throw new TcsError("Could not reach TCS. Please try again.");
  } finally {
    clearTimeout(timer);
  }
}

// The bearer token is valid for hours; keep it per isolate and re-use it (one in-flight login at a time).
let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

async function login(): Promise<string> {
  const username = process.env.TCS_USERNAME;
  const password = process.env.TCS_PASSWORD;
  if (!username || !password) throw new TcsError("TCS is not configured (TCS_USERNAME / TCS_PASSWORD are not set).");
  const query = new URLSearchParams({ username, password });
  const response = await rawFetch(`/ecom/api/authentication/token?${query}`, { method: "GET" });
  const body = (await response.json().catch(() => null)) as { accesstoken?: string; accessToken?: string; expiry?: string; message?: string } | null;
  const token = body?.accesstoken ?? body?.accessToken;
  if (!response.ok || !token) {
    throw new TcsError(response.status === 401 || response.status === 403 ? "TCS refused the username or password." : body?.message || `TCS login failed (HTTP ${response.status}).`, response.status);
  }
  const expiry = body?.expiry ? Date.parse(body.expiry) : NaN;
  tokenCache = { token, expiresAt: Number.isFinite(expiry) ? expiry - 60_000 : Date.now() + 50 * 60_000 };
  return token;
}

async function accessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  tokenInFlight ??= login().finally(() => {
    tokenInFlight = null;
  });
  return tokenInFlight;
}

/** Calls an authorised endpoint, logging in first and once more if the token was rejected. */
async function authed(path: string, init: { method: "GET" | "POST"; body?: Record<string, unknown>; query?: Record<string, string> }): Promise<Response> {
  const attempt = async (token: string) => {
    const query = init.query ? `?${new URLSearchParams(init.query)}` : "";
    return rawFetch(`${path}${query}`, {
      method: init.method,
      token,
      // TCS also wants the token inside the JSON body of POST calls.
      body: init.body ? JSON.stringify({ ...init.body, accesstoken: token }) : undefined,
    });
  };
  let response = await attempt(await accessToken());
  if (response.status === 401) response = await attempt(await accessToken(true));
  return response;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** TCS wants Pakistani mobile numbers as 03xxxxxxxxx (11 digits). Checkout stores whatever the customer
 * typed ("+92300…", "92300…", "0300…", with spaces/dashes), so normalise, and return null when it still
 * isn't a valid mobile number so the caller can ask for a correct one. */
export function toPkMobile(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, "");
  let local: string;
  if (digits.startsWith("92")) local = `0${digits.slice(2)}`;
  else if (digits.startsWith("0")) local = digits;
  else local = `0${digits}`;
  return /^03\d{9}$/.test(local) ? local : null;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** TCS name fields need at least 3 characters; a one-word name goes in firstname with a neutral middlename. */
export function splitName(fullName: string): { first: string; middle: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const pad = (value: string) => (value.length >= 3 ? value : `${value}${".".repeat(3 - value.length)}`);
  const first = pad(parts[0] ?? "Customer");
  if (parts.length === 1) return { first, middle: "Customer", last: "" };
  if (parts.length === 2) return { first, middle: pad(parts[1]), last: "" };
  return { first, middle: pad(parts[1]), last: pad(parts.slice(2).join(" ")).slice(0, 50) };
}

/** Address lines are limited to 120 characters each – split on a space, never mid-word where possible. */
export function splitAddress(address: string): [string, string, string] {
  const words = address.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = ["", "", ""];
  let line = 0;
  for (const word of words) {
    if (!lines[line]) lines[line] = word.slice(0, 120);
    else if (`${lines[line]} ${word}`.length <= 120) lines[line] += ` ${word}`;
    else if (line < 2) lines[++line] = word.slice(0, 120);
  }
  return [lines[0] || "NA", lines[1], lines[2]];
}

/** "DD/MM/YYYY HH:mm:ss" in Pakistan time, as in the TCS examples. */
export function tcsDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function describeItems(items: Array<{ productName: string; variantName: string; quantity: number }>, max = 50): string {
  return clip(items.map((item) => `${item.quantity}x ${item.productName}`).join(", "), max);
}

// ---------------------------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------------------------

export type TcsShipper = { name: string; address: string; cityName: string; cityCode: string; phone: string };

export type TcsBookingInput = {
  shipper: TcsShipper;
  referenceNo: string;
  consignee: { name: string; phone: string; email?: string | null; address: string; cityName: string; landmark?: string | null };
  codAmount: number;
  pieces: number;
  weightKg: number;
  fragile?: boolean;
  remarks?: string;
  items: Array<{ productName: string; variantName: string; quantity: number; unitPrice: number }>;
};

export async function bookTcsParcel(input: TcsBookingInput): Promise<{ consignmentNo: string }> {
  const { shipper, consignee } = input;
  const name = splitName(consignee.name);
  const [a1, a2, a3] = splitAddress(consignee.address);
  const [s1, s2] = splitAddress(shipper.address || "Nure Asmir");
  const perPiece = Math.max(0.5, Math.round((input.weightKg / Math.max(1, input.pieces)) * 2) / 2);

  const body = {
    consignmentno: "",
    shipperinfo: {
      tcsaccount: process.env.TCS_ACCOUNT_NO,
      shippername: clip(shipper.name || "Nure Asmir", 50),
      address1: s1,
      address2: s2,
      countrycode: "PK",
      countryname: "Pakistan",
      citycode: shipper.cityCode,
      cityname: shipper.cityName,
      mobile: toPkMobile(shipper.phone) ?? shipper.phone,
    },
    consigneeinfo: {
      firstname: name.first,
      middlename: name.middle,
      lastname: name.last,
      address1: a1,
      address2: a2,
      address3: a3,
      countrycode: "PK",
      countryname: "Pakistan",
      cityname: clip(consignee.cityName, 50),
      email: consignee.email ?? "",
      landmark: clip(consignee.landmark ?? "", 200),
      mobile: consignee.phone,
    },
    vendorinfo: {
      name: clip(shipper.name || "Nure Asmir", 50),
      address1: s1,
      citycode: shipper.cityCode,
      cityname: shipper.cityName,
      mobile: toPkMobile(shipper.phone) ?? shipper.phone,
    },
    shipmentinfo: {
      costcentercode: process.env.TCS_COST_CENTER_CODE,
      referenceno: clip(input.referenceNo, 50),
      contentdesc: describeItems(input.items),
      servicecode: process.env.TCS_SERVICE_CODE || "O",
      shipmentdate: tcsDate(),
      currency: "PKR",
      codamount: Math.max(0, Math.round(input.codAmount)),
      declaredvalue: null,
      insuredvalue: null,
      weightinkg: Math.max(0.5, input.weightKg),
      pieces: Math.max(1, input.pieces),
      fragile: Boolean(input.fragile),
      remarks: clip(input.remarks ?? "", 500),
      skus: input.items.map((item) => ({
        description: clip(`${item.productName}${item.variantName && item.variantName !== item.productName ? ` ${item.variantName}` : ""}`, 50),
        quantity: Math.max(1, item.quantity),
        weight: perPiece,
        uom: "KG",
        unitprice: Math.max(1, Math.round(item.unitPrice)),
        declaredvalue: null,
        insuredvalue: null,
      })),
    },
  };

  const response = await authed("/ecom/api/booking/create", { method: "POST", body });
  const data = (await response.json().catch(() => null)) as { consignmentNo?: string | number; response?: string; message?: string; status?: boolean | string; code?: string | number } | null;
  const ok = response.ok && data && (data.status === true || String(data.status) === "true") && data.consignmentNo;
  if (!ok) throw new TcsError(data?.message || (data?.response && data.response !== "SUCCESS" ? data.response : "") || `TCS could not book this parcel (HTTP ${response.status}).`, response.status);
  return { consignmentNo: String(data.consignmentNo) };
}

export async function cancelTcsParcel(consignmentNo: string): Promise<void> {
  const response = await authed("/ecom/api/booking/cancel", { method: "POST", body: { consignmentNumber: consignmentNo } });
  const data = (await response.json().catch(() => null)) as { message?: string; response?: string; status?: boolean | string } | null;
  const message = `${data?.message ?? ""} ${data?.response ?? ""}`;
  if (!response.ok || /fail|not found|error|cannot|can't|invalid/i.test(message) || data?.status === false) {
    throw new TcsError(data?.message || data?.response || `TCS could not cancel this booking (HTTP ${response.status}).`, response.status);
  }
}

/** Books a reverse pickup (the customer's return) for a delivered consignment. */
export async function bookTcsReversePickup(consignmentNo: string, consigneeMobile: string): Promise<void> {
  const response = await authed("/ecom/api/booking/reverse", {
    method: "POST",
    body: { costcentercode: process.env.TCS_COST_CENTER_CODE ?? "", consignmentno: consignmentNo, consigneemobileno: consigneeMobile },
  });
  const data = (await response.json().catch(() => null)) as { message?: string; status?: boolean | string } | null;
  if (!response.ok || (data?.message && !/success/i.test(data.message))) {
    throw new TcsError(data?.message || `TCS could not book the return pickup (HTTP ${response.status}).`, response.status);
  }
}

export type TcsTracking = {
  status: string | null;
  summary: string | null;
  events: Array<{ at: string; status: string; place: string | null }>;
};

export async function trackTcsParcel(consignmentNo: string): Promise<TcsTracking> {
  const response = await authed("/tracking/api/Tracking/GetDynamicTrackDetail", { method: "GET", query: { consignee: consignmentNo } });
  const data = (await response.json().catch(() => null)) as {
    checkpoints?: Array<{ datetime?: string; status?: string; recievedby?: string | null }> | null;
    deliveryinfo?: Array<{ datetime?: string; status?: string; station?: string | null }> | null;
    shipmentsummary?: string | null;
    message?: string;
  } | null;
  if (!response.ok) throw new TcsError(data?.message || `TCS tracking failed (HTTP ${response.status}).`, response.status);
  if (!data || data.message === "FAIL" || (!data.checkpoints?.length && !data.deliveryinfo?.length)) {
    // TCS answers 200 + FAIL for a consignment it has no scans for yet – that is "booked, not collected".
    return { status: null, summary: data?.shipmentsummary ?? null, events: [] };
  }
  const events = (data.checkpoints ?? []).map((point) => ({ at: point.datetime ?? "", status: point.status ?? "", place: point.recievedby ?? null })).filter((event) => event.status);
  // Checkpoints are newest-first; the summary line looks like "Current Status: DELIVERED\n…".
  const latest = events[0]?.status ?? data.deliveryinfo?.[0]?.status ?? null;
  return { status: latest, summary: data.shipmentsummary ?? null, events };
}

/** Downloads the TCS shipping label (PDF) for a consignment. */
export async function fetchTcsLabel(consignmentNo: string): Promise<Response> {
  const response = await authed("/ecom/api/print/label", { method: "GET", query: { consignmentno: consignmentNo, shipperdetail: "true" } });
  if (!response.ok) throw new TcsError(`TCS could not produce the label (HTTP ${response.status}).`, response.status);
  return response;
}

/** Used by Settings → "Test TCS connection": logs in and nothing else. */
export async function testTcsConnection(): Promise<{ ok: true; environment: string } | { ok: false; error: string }> {
  if (!isTcsConfigured()) return { ok: false, error: "The TCS username, password, account number or cost-centre code has not been added to the website yet." };
  try {
    await accessToken(true);
    return { ok: true, environment: process.env.TCS_ENV === "production" ? "live" : "test" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach TCS." };
  }
}
