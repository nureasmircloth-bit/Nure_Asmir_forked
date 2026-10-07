import { expect, test } from "@playwright/test";
import { htmlToText, IMPORTANT_HEADERS, orderProviders, shouldFailOver, splitFrom } from "../../lib/email/transport";
import { groqKeys, keyOrder, restKey } from "../../lib/groq";

test.describe("email transport", () => {
  test("splits the From address and builds a readable plain-text copy", () => {
    expect(splitFrom("Nure Asmir <orders@nureasmir.com>")).toEqual({ name: "Nure Asmir", email: "orders@nureasmir.com" });
    expect(splitFrom("orders@nureasmir.com")).toEqual({ name: "", email: "orders@nureasmir.com" });
    const text = htmlToText('<style>p{color:red}</style><h1>Order 12</h1><p>Total&nbsp;Rs&amp;5</p><a href="https://nureasmir.com/track">Track</a>');
    expect(text).toContain("Order 12");
    expect(text).toContain("Total Rs&5");
    expect(text).toContain("Track (https://nureasmir.com/track)");
    expect(text).not.toContain("color:red");
  });

  test("plain-text copy: nested tags cannot survive and entities are decoded only once", () => {
    expect(htmlToText("<scr<b>ipt>alert(1)</scr</b>ipt>Hi")).not.toMatch(/<\/?script/i);
    expect(htmlToText("<<b>b>Hi<</b>/b>")).not.toContain("<b>");
    expect(htmlToText("5 &amp;lt; 6")).toBe("5 &lt; 6");
    expect(htmlToText("a&nbsp;b &quot;q&quot; &#39;s&#39;")).toBe("a b \"q\" 's'");
    expect(htmlToText("")).toBe("");
  });

  test("marks mail as important and only fails over for quota, key or outage problems", () => {
    expect(IMPORTANT_HEADERS.Importance).toBe("high");
    expect(IMPORTANT_HEADERS["X-Priority"]).toBe("1");
    for (const status of [401, 402, 403, 429, 500, 503]) expect(shouldFailOver(status), String(status)).toBe(true);
    for (const status of [400, 404, 422]) expect(shouldFailOver(status), String(status)).toBe(false);
  });

  test("the provider with the most room left is tried first; ties keep the configured order", () => {
    const providers = [{ service: "resend" as const }, { service: "resend-2" as const }, { service: "brevo" as const }];
    expect(orderProviders(providers, new Map([["resend", 100]])).map((p) => p.service)).toEqual(["resend-2", "brevo", "resend"]);
    expect(orderProviders(providers, new Map()).map((p) => p.service)).toEqual(["resend", "resend-2", "brevo"]);
    expect(orderProviders(providers, new Map([["resend", 50], ["resend-2", 10], ["brevo", 270]])).map((p) => p.service)).toEqual(["resend-2", "resend", "brevo"]);
  });
});

test.describe("Groq keys in turn", () => {
  test("finds every configured key once, in a stable order", () => {
    expect(groqKeys({ GROQ_API_KEY: "a", GROQ_API_KEY_2: "b", GROQ_API_KEY_3: "c" })).toEqual(["a", "b", "c"]);
    expect(groqKeys({ GROQ_API_KEY: "a", GROQ_API_KEY_2: "a", GROQ_API_KEYS: "c, d ,," })).toEqual(["a", "c", "d"]);
    expect(groqKeys({})).toEqual([]);
  });

  test("calls rotate through the keys, and a resting key goes to the back", () => {
    const keys = ["k1", "k2", "k3"];
    expect(keyOrder(keys, 0)).toEqual([0, 1, 2]);
    expect(keyOrder(keys, 1)).toEqual([1, 2, 0]);
    expect(keyOrder(keys, 5)).toEqual([2, 0, 1]);
    restKey("k2", 60_000);
    expect(keyOrder(keys, 0)).toEqual([0, 2, 1]);
    expect(keyOrder(keys, 1)).toEqual([2, 0, 1]);
    restKey("k2", -1); // allowance back: no longer resting
    expect(keyOrder(keys, 0)).toEqual([0, 1, 2]);
  });
});
