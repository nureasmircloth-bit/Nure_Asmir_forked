import { expect, test } from "@playwright/test";
import { LAB_CHECKS } from "../../lib/lab-check-queries";
import { LABS, labById } from "../../lib/labs";

test.describe("training labs", () => {
  test("every lab has an English and a Roman Urdu text for its title, goal and every step, and ids are unique", () => {
    const ids = new Set<string>();
    for (const lab of LABS) {
      expect(ids.has(lab.id), `duplicate id ${lab.id}`).toBe(false);
      ids.add(lab.id);
      for (const text of [lab.title, lab.goal, ...lab.steps.map((step) => step.text)]) {
        expect(text.en.trim().length, `${lab.id} English`).toBeGreaterThan(5);
        expect(text.ur.trim().length, `${lab.id} Roman Urdu`).toBeGreaterThan(5);
      }
      expect(lab.minutes).toBeGreaterThan(0);
    }
  });

  test("every step points at a page inside the admin", () => {
    for (const lab of LABS) for (const step of lab.steps) expect(step.href, lab.id).toMatch(/^\/admin(\/|$)/);
  });

  test("each lab has exactly one check per step, and no check belongs to a missing lab", () => {
    for (const lab of LABS) expect(LAB_CHECKS[lab.id]?.length, `checks for ${lab.id}`).toBe(lab.steps.length);
    for (const id of Object.keys(LAB_CHECKS)) expect(labById(id), `lab ${id}`).toBeDefined();
  });

  test("checks only read: no statement changes data, and each asks one yes/no question", () => {
    for (const [id, queries] of Object.entries(LAB_CHECKS)) {
      for (const query of queries) {
        expect(query, id).toMatch(/^select exists \(/i);
        expect(query, id).not.toMatch(/\b(insert|update|delete|drop|truncate|alter|create|grant)\b/i);
        expect(query, id).toMatch(/\bas ok$/);
      }
    }
  });
});
