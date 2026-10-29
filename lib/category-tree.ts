/** Pure helpers for categories that sit inside other categories (Shirts > Formal Shirts > Business Formal Shirts). No database access here. */

export const PATH_SEPARATOR = ">";
export const MAX_DEPTH = 6;

export type TreeNode = { id: string; name: string; slug: string; parentId: string | null; sortOrder: number };
export type TreeItem<T extends TreeNode> = T & { depth: number; path: string[] };

/** "Shirts > Formal  Shirts" -> ["Shirts", "Formal Shirts"]: pieces trimmed, doubled spaces and empty pieces dropped. */
export function splitCategoryPath(raw: string): string[] {
  return raw
    .split(PATH_SEPARATOR)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/** Every node in display order (parents before their children, siblings by sort order then name), with its depth and the names from the top down.
 * A node whose parent is missing, or that would loop back on itself, is treated as top level so bad data can never hide or hang a category. */
export function flattenTree<T extends TreeNode>(nodes: T[]): TreeItem<T>[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const order = (a: T, b: T) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const out: TreeItem<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, path: string[]) => {
    for (const node of (children.get(parent) ?? []).sort(order)) {
      if (seen.has(node.id) || depth >= MAX_DEPTH + 4) continue;
      seen.add(node.id);
      const names = [...path, node.name];
      out.push({ ...node, depth, path: names });
      walk(node.id, depth + 1, names);
    }
  };
  walk(null, 0, []);
  // anything left over sits in a loop of parents: show it at the top rather than lose it
  for (const node of nodes) if (!seen.has(node.id)) out.push({ ...node, depth: 0, path: [node.name] });
  return out;
}

/** The ids of a category and everything inside it. */
export function descendantIds(nodes: TreeNode[], rootId: string): string[] {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && out.has(node.parentId) && !out.has(node.id)) {
        out.add(node.id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** The categories from the top level down to this one (for the breadcrumb). Empty when the id is unknown. */
export function ancestry<T extends TreeNode>(nodes: T[], id: string): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** Whether moving `id` under `parentId` would put a category inside itself (or inside one of its own children). */
export function wouldLoop(nodes: TreeNode[], id: string, parentId: string | null): boolean {
  if (!parentId) return false;
  return descendantIds(nodes, id).includes(parentId);
}

/** Every category in tree order with `name` replaced by its full path ("Shirts > Formal Shirts"), the form the product pages and the Excel sheet use
 * to name a category that sits inside others. */
export function withPathNames<T extends TreeNode>(nodes: T[]): T[] {
  return flattenTree(nodes).map((item) => ({ ...item, name: item.path.join(` ${PATH_SEPARATOR} `) }));
}

/** The label shown in pickers: "Shirts › Formal Shirts › Business Formal Shirts". */
export function pathLabel(path: string[]): string {
  return path.join(" › ");
}
