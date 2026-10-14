import { expect, test } from "@playwright/test";
import { chromeCss, contrastRatio, readableOn, textIsReadable } from "../../lib/theme-chrome";

test.describe("shop frame colours", () => {
  test("the automatic text colour is the one with the better contrast ratio", () => {
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#000000")).toBe("#ffffff");
    // mid grey: white would only reach about 2.8:1, near-black is clearly better
    expect(readableOn("#999999")).toBe("#111111");
    expect(contrastRatio("#999999", readableOn("#999999"))).toBeGreaterThan(4.5);
    for (const bg of ["#c5a059", "#0b3d2e", "#14213d", "#fff3d6", "#555555"]) {
      expect(contrastRatio(bg, readableOn(bg)), bg).toBeGreaterThanOrEqual(4.5);
    }
    // on the very middle greys neither near-black nor white reaches 4.5:1, so pure black is used
    for (const bg of ["#777777", "#767676", "#808080", "#7a7a7a"]) expect(contrastRatio(bg, readableOn(bg)), bg).toBeGreaterThanOrEqual(4.5);
  });

  test("a text colour that is hard to read on its background is ignored, also on the built-in background", () => {
    expect(textIsReadable("#111111", "#0d0d0d")).toBe(false);
    expect(chromeCss({ themeFooterTextColor: "#111111" })).toBe(""); // dark text on the built-in dark footer: left alone
    expect(chromeCss({ themeFooterTextColor: "#ffffff" })).toContain("color:#ffffff");
    // a chosen background with an unreadable chosen text falls back to a readable automatic colour
    const css = chromeCss({ themeHeaderColor: "#14213d", themeHeaderTextColor: "#1a1a40" });
    expect(css).toContain(".site-header,.site-header a");
    expect(css).toContain("color:#ffffff");
    expect(css).not.toContain("#1a1a40");
  });

  test("the phone bar sits on the page colour unless it has its own", () => {
    expect(chromeCss({ themeBackgroundColor: "#101012", themeBottomBarTextColor: "#111111" })).toBe("");
    expect(chromeCss({ themeBackgroundColor: "#101012", themeBottomBarTextColor: "#f5f5f5" })).toContain("color:#f5f5f5");
  });

  test("only #rrggbb values reach the CSS", () => {
    expect(chromeCss({ themeFooterColor: "red; } body { display:none" })).toBe("");
    expect(chromeCss({ themeFooterColor: "#12345" })).toBe("");
  });
});
