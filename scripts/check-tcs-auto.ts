// Tries automatic TCS booking against a throw-away local database and the local TCS stand-in (e2e/support/mock-tcs.mjs).
// Start the stand-in first, then: LOCAL_DB_PATH=<file> TCS_BASE_URL=http://127.0.0.1:4011 TCS_USERNAME=tcs-user TCS_PASSWORD=tcs-pass
// TCS_ACCOUNT_NO=TEST TCS_COST_CENTER_CODE=01 node ./node_modules/tsx/dist/cli.mjs scripts/check-tcs-auto.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, siteSettings } from "@/db/schema";
import { autoBookOnConfirm, bookOrderWithTcs, saveManualTracking, syncCourierStatuses } from "@/lib/courier";
import { moveOrder } from "@/lib/order-actions";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) { failures++; if (detail !== undefined) console.log(JSON.stringify(detail)); } };
const bookings = async () => ((await (await fetch(`${process.env.TCS_BASE_URL}/__state`)).json()) as { bookings: Array<{ referenceno: string }> }).bookings;

async function makeOrder(number: string, extra: Partial<typeof orders.$inferInsert> = {}) {
  const [row] = await db.insert(orders).values({
    orderNumber: number, customerName: "Test Buyer", customerPhone: "03001234567", city: "Lahore", province: "Punjab", address: "House 1, Street 2, Cantt",
    subtotal: 5000, deliveryCharge: 250, discount: 0, tax: 0, total: 5250, currency: "PKR", paymentMethod: "cod", paymentStatus: "pending", orderStatus: "pending_confirmation", ...extra,
  }).returning();
  await db.insert(orderItems).values({ orderId: row.id, productName: "Kurta", variantName: "M", sku: "K-M", unitPrice: 5000, quantity: 1, lineTotal: 5000 });
  return row.id;
}
const read = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0];
const autoBooking = async (on: boolean) => {
  await db.insert(siteSettings).values({ id: "store", tcsAutoBook: on, tcsShipperCityName: "Lahore", tcsShipperCityCode: "LHE", tcsShipperPhone: "03001112222" }).onConflictDoUpdate({ target: siteSettings.id, set: { tcsAutoBook: on } });
};

async function main() {
  if (!process.env.LOCAL_DB_PATH || !/127\.0\.0\.1|localhost/.test(process.env.TCS_BASE_URL ?? "")) { console.error("Set LOCAL_DB_PATH and point TCS_BASE_URL at the local stand-in."); process.exit(2); }
  await fetch(`${process.env.TCS_BASE_URL}/__state`, { method: "DELETE" });

  await autoBooking(false);
  const manual = await makeOrder("T-OFF");
  const off = await moveOrder(manual, "confirmed", "tester@example.com");
  check("switch OFF: confirming books nothing and shows no notice", off.ok && !off.courierNotice && !(await read(manual)).courierTrackingNumber && (await bookings()).length === 0, off);
  const pressed = await bookOrderWithTcs(manual, "tester@example.com");
  check("switch OFF: the Book with TCS button still books it", pressed.ok && Boolean((await read(manual)).courierTrackingNumber), pressed);

  await autoBooking(true);
  const domestic = await makeOrder("T-ON");
  const on = await moveOrder(domestic, "confirmed", "tester@example.com");
  const booked = await read(domestic);
  check("switch ON: confirming books the order and says 'TCS booked' with the number", on.ok && on.courierNotice?.tone === "good" && on.courierNotice.text.includes(booked.courierTrackingNumber ?? "-") && /TCS booked/.test(on.courierNotice.text), on);
  check("exactly one parcel for it at TCS", (await bookings()).filter((b) => b.referenceno === "T-ON").length === 1, await bookings());
  const again = await autoBookOnConfirm(domestic, "tester@example.com");
  check("asking again never books a second parcel", again === null && (await bookings()).filter((b) => b.referenceno === "T-ON").length === 1, again);
  const twice = await moveOrder(domestic, "confirmed", "tester@example.com");
  check("confirming twice is refused and books nothing more", !twice.ok && (await bookings()).filter((b) => b.referenceno === "T-ON").length === 1, twice);

  const before = (await bookings()).length;
  const abroad = await makeOrder("T-ABROAD", { isInternational: true, customerPhone: "+971501234567", city: "Dubai", province: "UAE" });
  const intl = await moveOrder(abroad, "confirmed", "tester@example.com");
  check("overseas: confirmed, never booked, and the screen says why", intl.ok && intl.courierNotice?.tone === "info" && !(await read(abroad)).courierTrackingNumber && (await bookings()).length === before, intl);
  const forced = await bookOrderWithTcs(abroad, "tester@example.com");
  check("overseas: the Book with TCS action (also used by bulk booking) is refused", !forced.ok && /outside Pakistan/.test(forced.ok ? "" : forced.message) && (await bookings()).length === before, forced);
  const hand = await saveManualTracking(abroad, "DHL1234567890", "tester@example.com", "DHL");
  check("overseas: courier name and tracking number are saved by hand", hand.ok && (await read(abroad)).courierName === "DHL", hand);

  const bad = await makeOrder("T-BADPHONE", { customerPhone: "12345" });
  const failed = await moveOrder(bad, "confirmed", "tester@example.com");
  const badRow = await read(bad);
  check("a bad phone: the order stays confirmed, shows the reason, and saves it on the order", failed.ok && failed.courierNotice?.tone === "bad" && badRow.orderStatus === "confirmed" && !badRow.courierTrackingNumber && /mobile/.test(badRow.courierAutoError ?? ""), failed);

  const local = await saveManualTracking(bad, "779412326902", "tester@example.com", "DHL");
  check("a Pakistan order stays TCS even if another courier is sent", local.ok && (await read(bad)).courierName === "TCS" && !(await read(bad)).courierAutoError, local);

  const summary = await syncCourierStatuses({ force: true });
  check("the tracking check skips overseas parcels", (await read(abroad)).courierSyncedAt === null, summary);

  console.log(failures ? `${failures} failed` : "all passed");
  process.exit(failures ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
