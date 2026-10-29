import { expect, test } from "@playwright/test";
import { ancestry, descendantIds, flattenTree, splitCategoryPath, withPathNames, wouldLoop, type TreeNode } from "../../lib/category-tree";

const node = (id: string, name: string, parentId: string | null, sortOrder = 0): TreeNode => ({ id, name, slug: id, parentId, sortOrder });
const shop = [
  node("shirts", "Shirts", null, 1),
  node("formal", "Formal Shirts", "shirts"),
  node("business", "Business Formal Shirts", "formal", 1),
  node("designer", "Designer Formal Shirts", "formal", 2),
  node("floral", "Floral Shirts", "shirts", 5),
  node("pants", "Pants", null, 2),
];

test("a category path is split into clean names", () => {
  expect(splitCategoryPath(" Shirts >  Formal   Shirts > > Business ")).toEqual(["Shirts", "Formal Shirts", "Business"]);
  expect(splitCategoryPath("Pants")).toEqual(["Pants"]);
  expect(splitCategoryPath("  ")).toEqual([]);
});

test("the tree lists parents before their children with depth and path", () => {
  expect(flattenTree(shop).map((item) => `${item.depth}:${item.name}`)).toEqual([
    "0:Shirts",
    "1:Formal Shirts",
    "2:Business Formal Shirts",
    "2:Designer Formal Shirts",
    "1:Floral Shirts",
    "0:Pants",
  ]);
  expect(withPathNames(shop).map((item) => item.name)[2]).toBe("Shirts > Formal Shirts > Business Formal Shirts");
});

test("a category's descendants and ancestry", () => {
  expect(descendantIds(shop, "shirts").sort()).toEqual(["business", "designer", "floral", "formal", "shirts"]);
  expect(descendantIds(shop, "pants")).toEqual(["pants"]);
  expect(ancestry(shop, "business").map((item) => item.id)).toEqual(["shirts", "formal", "business"]);
  expect(ancestry(shop, "nope")).toEqual([]);
});

test("a category cannot move inside itself, and bad parents never hide or hang a category", () => {
  expect(wouldLoop(shop, "shirts", "business")).toBe(true);
  expect(wouldLoop(shop, "shirts", "shirts")).toBe(true);
  expect(wouldLoop(shop, "pants", "shirts")).toBe(false);
  expect(wouldLoop(shop, "pants", null)).toBe(false);
  const broken = [node("a", "A", "b"), node("b", "B", "a"), node("c", "C", "missing")];
  expect(flattenTree(broken).map((item) => item.id).sort()).toEqual(["a", "b", "c"]);
});
