import { expect, test } from "@playwright/test";
import { isPracticeRequest, runInPractice } from "../../lib/practice-context";
import { makePracticeCookie, PRACTICE_COOKIE, readCookie, requestIsPractising, verifyPracticeCookie } from "../../lib/practice-cookie";

const SECRET = "unit-test-secret";
const request = (cookie: string) => ({ headers: { get: (name: string) => (name.toLowerCase() === "cookie" ? cookie : null) } });

test.describe("practice mode cookie", () => {
  test("a cookie made with the secret works until it expires, and not a second longer", async () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    const { value, expires } = await makePracticeCookie(SECRET, now, 120);
    expect(expires.getTime()).toBe(now + 120 * 60_000);
    expect(await verifyPracticeCookie(value, SECRET, now + 60_000)).toBe(true);
    expect(await verifyPracticeCookie(value, SECRET, now + 119 * 60_000)).toBe(true);
    expect(await verifyPracticeCookie(value, SECRET, now + 121 * 60_000)).toBe(false);
  });

  test("nobody can make one up, change the time, or use another secret", async () => {
    const { value } = await makePracticeCookie(SECRET);
    const [time, signature] = value.split(".");
    expect(await verifyPracticeCookie(value, "another-secret")).toBe(false);
    expect(await verifyPracticeCookie(`${Number(time) + 3_600_000}.${signature}`, SECRET)).toBe(false);
    expect(await verifyPracticeCookie(`${time}.${"0".repeat(signature.length)}`, SECRET)).toBe(false);
    for (const junk of ["", "x", "123", "abc.def", `${time}.`, `.${signature}`, null, undefined]) expect(await verifyPracticeCookie(junk as string, SECRET)).toBe(false);
    expect(await verifyPracticeCookie(value, "")).toBe(false);
    expect(await verifyPracticeCookie(value, undefined)).toBe(false);
  });

  test("a request counts as practising only when it carries a good cookie among its others", async () => {
    const { value } = await makePracticeCookie(SECRET);
    expect(readCookie(`a=1; ${PRACTICE_COOKIE}=${encodeURIComponent(value)}; b=2`, PRACTICE_COOKIE)).toBe(value);
    expect(await requestIsPractising(request(`theme=dark; ${PRACTICE_COOKIE}=${value}; ms_admin_session=abc`), SECRET)).toBe(true);
    expect(await requestIsPractising(request("theme=dark"), SECRET)).toBe(false);
    expect(await requestIsPractising(request(`${PRACTICE_COOKIE}=${value}x`), SECRET)).toBe(false);
  });

  test("the practice flag follows the work started inside it, including work that finishes later, and nothing outside", async () => {
    expect(isPracticeRequest()).toBe(false);
    let later = false;
    let afterAwait = false;
    await runInPractice(async () => {
      expect(isPracticeRequest()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 5));
      afterAwait = isPracticeRequest();
      void new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
        later = isPracticeRequest(); // a background job started by the request (a notification, an email)
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(afterAwait).toBe(true);
    expect(later).toBe(true);
    expect(isPracticeRequest()).toBe(false);
  });
});
