import { expect, test } from "@playwright/test";
import { LESSONS } from "../../app/admin/(protected)/training/lessons";
import { UR } from "../../lib/training-ur";

test.describe("training translations", () => {
  test("every lesson has Roman Urdu text with exactly as many lines as it has steps, and nothing extra", () => {
    for (const lesson of LESSONS) {
      const text = UR[lesson.id];
      expect(text, `${lesson.id} has no Roman Urdu text`).toBeTruthy();
      expect(text.steps.length, `${lesson.id}: Roman Urdu lines vs steps`).toBe(lesson.steps.length);
      expect(text.title.length).toBeGreaterThan(3);
    }
    const known = new Set(LESSONS.map((lesson) => lesson.id));
    for (const id of Object.keys(UR)) expect(known.has(id), `UR has a lesson "${id}" that does not exist`).toBe(true);
  });
});
