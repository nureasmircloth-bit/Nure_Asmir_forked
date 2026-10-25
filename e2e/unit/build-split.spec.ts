import fs from "node:fs";
import { expect, test } from "@playwright/test";

// The site is built as four separate Workers (scripts/build-target.mjs). Each build moves the directories it must not contain aside, so a
// change can never pull admin, developer or training code into the storefront, or the storefront into an admin-side build.
const text = fs.readFileSync("scripts/build-target.mjs", "utf8");
const block = (name: string): string => {
  const at = text.indexOf(`const ${name} = [`);
  expect(at, `${name} is defined`).toBeGreaterThan(-1);
  return text.slice(at, text.indexOf("];", at));
};
const excludeBlock = text.slice(text.indexOf("const EXCLUDE = {"), text.indexOf("}[target]"));
const line = (target: string): string => {
  const at = excludeBlock.indexOf(`  ${target}: [`);
  expect(at, `${target} has an exclude list`).toBeGreaterThan(-1);
  return excludeBlock.slice(at, excludeBlock.indexOf("\n", at));
};

test("the admin-side builds keep the picture route, and the store build still leaves admin code out", () => {
  // The admin pages show product thumbnails from their OWN address (/cdn/products/...), so every admin-side Worker must contain the picture route.
  // It was once left out of the admin build and every admin thumbnail returned 404.
  for (const part of [block("STORE_ONLY"), block("DEVELOPER_ONLY"), block("TRAINING_ONLY"), line("store")]) {
    expect(part).not.toContain('"app/cdn"');
    expect(part).not.toContain('"app/api/media');
  }
  expect(block("STORE_ONLY")).toContain('"app/(store)"');
  expect(line("store")).toContain('"app/admin"');
  expect(line("store")).toContain('"app/api/admin"');
});

test("each of the four builds leaves out exactly what belongs to the others", () => {
  expect(line("admin")).toContain("STORE_ONLY");
  expect(line("admin")).toContain("DEVELOPER_ONLY"); // the owner never downloads the developer console...
  expect(line("admin")).toContain("TRAINING_ONLY"); // ...or the practice shop
  expect(line("training")).toContain("STORE_ONLY");
  expect(line("training")).toContain("DEVELOPER_ONLY");
  expect(line("training")).not.toContain("TRAINING_ONLY");
  expect(line("developer")).toContain("STORE_ONLY");
  expect(line("developer")).toContain("TRAINING_ONLY");
  expect(line("developer")).not.toContain("DEVELOPER_ONLY");
  expect(block("DEVELOPER_ONLY")).toContain("developer");
  expect(block("TRAINING_ONLY")).toContain("training");
  expect(block("TRAINING_ONLY")).toContain("app/api/admin/sandbox");
});

test("every build has its own Worker config with its own name and database binding", () => {
  const configs: Record<string, string> = {
    "wrangler.jsonc": "nure-asmir",
    "wrangler.admin.jsonc": "nure-asmir-admin",
    "wrangler.developer.jsonc": "nure-asmir-developer",
    "wrangler.training.jsonc": "nure-asmir-training",
  };
  const ids = new Map<string, string>();
  for (const [file, name] of Object.entries(configs)) {
    const content = fs.readFileSync(file, "utf8");
    expect(content, file).toContain(`"name": "${name}"`);
    const database = content.match(/"binding": "DB", "database_name": "([^"]+)", "database_id": "([0-9a-f-]{36})"/);
    expect(database, `${file} binds the D1 database as DB`).not.toBeNull();
    ids.set(file, database![1]);
  }
  // the training lab must never share the real shop's database
  expect(ids.get("wrangler.training.jsonc")).toBe("nure-asmir-training");
  for (const file of ["wrangler.jsonc", "wrangler.admin.jsonc", "wrangler.developer.jsonc"]) expect(ids.get(file)).toBe("nure-asmir-prod");
});
