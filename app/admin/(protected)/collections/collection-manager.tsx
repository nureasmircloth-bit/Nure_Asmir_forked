"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cropImageClientSide, processImageClientSide } from "@/lib/client-image-processing";
import { ImageCropper } from "../campaign/image-cropper";
import { descendantIds, flattenTree, MAX_DEPTH, pathLabel } from "@/lib/category-tree";
import { useToast } from "../../_ui/client";

/** Like fetch, but a dropped connection gives a normal "could not reach the server" answer instead of an error nobody catches. */
async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    return new Response(JSON.stringify({ error: "Could not reach the server. Check your internet and try again." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

const CARD_ASPECT = 3 / 4;
const HERO_ASPECT = 21 / 9;

type PixelCrop = { x: number; y: number; width: number; height: number };
type ImageSlot = { file: File | null; crop: PixelCrop | null; previewUrl: string | null };
const EMPTY_SLOT: ImageSlot = { file: null, crop: null, previewUrl: null };

async function makePreview(file: File, crop: PixelCrop): Promise<string> {
  const bitmap = await cropImageClientSide(file, crop);
  const previewWidth = 240;
  const previewHeight = Math.max(1, Math.round((bitmap.height / bitmap.width) * previewWidth));
  const canvas = document.createElement("canvas");
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.7);
}

/** A picture chooser that shows what was chosen (the browser's own file button hides the name on narrow screens). */
function FilePick({ name, onPick }: { name?: string; onPick: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="file-pick">
      <button type="button" onClick={() => input.current?.click()}>{name ? "Choose another" : "Choose picture"}</button>
      <small className="file-pick-name">{name ?? "Nothing chosen yet"}</small>
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={(event) => { onPick(event.target.files?.[0] ?? null); event.target.value = ""; }} />
    </div>
  );
}

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  subcategories: string | null;
  parentId: string | null;
  status: string;
  showOnHome: boolean;
  sortOrder: number;
  imageUrl: string | null;
  heroImageUrl: string | null;
  /** The size chart picture shown on product pages of this category (null = none). */
  sizeChartUrl: string | null;
  /** How many published products sit in this category. */
  liveProducts: number;
};
export function CollectionManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const toast = useToast();
  // Messages appear as a notice on the screen (a banner at the top of a long list is out of sight).
  const setMessage = useCallback((text: string) => { if (text) toast(text, /could not|couldn.t|failed|went wrong|not hidden|choose|cannot|error/i.test(text) ? "bad" : "good"); }, [toast]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);

  // Which category's photo picker is currently open, plus its pending (uncropped-yet-confirmed or
  // already-cropped) card/hero slots — one shared pair reused across rows, mirroring how the
  // campaign slide manager tracks a single editingSlideId rather than per-row state for every
  // category at once.
  const [photoEditId, setPhotoEditId] = useState<string | null>(null);
  const [cardSlot, setCardSlot] = useState<ImageSlot>(EMPTY_SLOT);
  const [heroSlot, setHeroSlot] = useState<ImageSlot>(EMPTY_SLOT);
  const [cropTarget, setCropTarget] = useState<"card" | "hero" | null>(null);

  const refreshCategories = useCallback(async () => {
    const response = await request("/api/admin/categories", { cache: "no-store" });
    if (response.ok) setCategories((await response.json()).categories);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshCategories();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshCategories]);

  // The categories as a folder tree: parents first, each followed by what is inside it.
  const tree = useMemo(() => flattenTree(categories), [categories]);
  const shown = useMemo(() => (find.trim() ? tree.filter((entry) => pathLabel(entry.path).toLowerCase().includes(find.trim().toLowerCase())) : tree), [tree, find]);
  /** A category cannot be put inside itself or inside one of its own categories. */
  const blocked = (id: string) => new Set(descendantIds(categories, id));

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { ...Object.fromEntries(new FormData(event.currentTarget)), parentId: new FormData(event.currentTarget).get("parentId") || null };
    const response = await request("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setMessage(response.ok ? "Category created." : result.error ?? "Category could not be created.");
    if (response.ok) {
      event.currentTarget.reset();
      await refreshCategories();
    }
  }

  function startPhotoEdit(categoryId: string) {
    setPhotoEditId(categoryId);
    setCardSlot(EMPTY_SLOT);
    setHeroSlot(EMPTY_SLOT);
  }

  function cancelPhotoEdit() {
    setPhotoEditId(null);
    setCardSlot(EMPTY_SLOT);
    setHeroSlot(EMPTY_SLOT);
  }

  function pickPhoto(target: "card" | "hero", file: File | null) {
    if (!file) return;
    (target === "card" ? setCardSlot : setHeroSlot)({ file, crop: null, previewUrl: null });
    setCropTarget(target);
  }

  async function confirmPhotoCrop(crop: PixelCrop) {
    const target = cropTarget;
    setCropTarget(null);
    if (!target) return;
    const setSlot = target === "card" ? setCardSlot : setHeroSlot;
    setSlot((slot) => (slot.file ? { ...slot, crop } : slot));
    const file = target === "card" ? cardSlot.file : heroSlot.file;
    if (!file) return;
    try {
      const previewUrl = await makePreview(file, crop);
      setSlot((slot) => ({ ...slot, previewUrl }));
    } catch {
      // Preview is a nicety only — the stored crop rect is what actually matters at upload time.
    }
  }

  async function processPhotoSlot(slot: ImageSlot, prefix: string, form: FormData) {
    if (!slot.file || !slot.crop) return;
    const bitmap = await cropImageClientSide(slot.file, slot.crop);
    const processed = await processImageClientSide(bitmap);
    if (!processed) return;
    const largest = processed.variants[processed.variants.length - 1];
    form.set(prefix ? `${prefix}File` : "file", largest.blob, `category-${prefix || "card"}.webp`);
    form.set(`${prefix}blurDataUrl`, processed.blurDataUrl);
    form.set(`${prefix}variantWidths`, JSON.stringify(processed.variants.map((v) => v.width)));
    for (const variant of processed.variants) {
      form.set(`${prefix}variant_${variant.width}`, variant.blob, `${prefix}variant-${variant.width}.webp`);
    }
  }

  async function saveCategoryPhotos(category: Category) {
    if (!cardSlot.crop && !heroSlot.crop) {
      setMessage("Choose and crop at least one photo first.");
      return;
    }
    setImageBusyId(category.id);
    setMessage("Processing image…");
    try {
      const form = new FormData();
      form.set("altText", category.name);
      await processPhotoSlot(cardSlot, "", form);
      await processPhotoSlot(heroSlot, "hero", form);

      setMessage("Uploading…");
      const response = await request(`/api/admin/categories/${category.id}/image`, { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      setMessage(response.ok ? "Category photos updated." : (result.error ?? "Image upload failed."));
      if (response.ok) {
        cancelPhotoEdit();
        await refreshCategories();
      }
    } catch (error) {
      console.error("saveCategoryPhotos failed", error);
      setMessage("Something went wrong uploading the image — check your connection and try again.");
    } finally {
      setImageBusyId(null);
    }
  }

  async function removeCategoryImage(category: Category, target: "card" | "hero" = "card") {
    const label = target === "hero" ? "hero banner photo" : "cover photo";
    if (!window.confirm(`Remove the ${label} for "${category.name}"?`)) return;
    setImageBusyId(category.id);
    try {
      const response = await request(`/api/admin/categories/${category.id}/image${target === "hero" ? "?target=hero" : ""}`, {
        method: "DELETE",
      });
      setMessage(response.ok ? "Photo removed." : "Photo could not be removed.");
      if (response.ok) await refreshCategories();
    } finally {
      setImageBusyId(null);
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const body: Record<string, unknown> = { ...Object.fromEntries(new FormData(event.currentTarget)), parentId: new FormData(event.currentTarget).get("parentId") || null };
    const send = () => request(`/api/admin/categories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let response = await send();
    let result = await response.json().catch(() => ({}));
    // Hiding a category that still has products on the website needs a clear yes (it disappears from the shop menu).
    if (response.status === 409 && result.needsConfirm) {
      if (!window.confirm(`${result.error}\n\nHide it anyway?`)) { setMessage("Not hidden. The category stays in the menu."); await refreshCategories(); return; }
      body.confirmHide = true;
      response = await send();
      result = await response.json().catch(() => ({}));
    }
    setMessage(response.ok ? "Category updated." : result.error ?? "Category could not be updated.");
    if (response.ok) await refreshCategories();
  }

  /** Hides ("archive") or deletes for good every product of a category and the categories inside it. Always shows the count first. */
  async function clearCategoryProducts(category: Category, mode: "archive" | "delete") {
    const call = (extra: Record<string, unknown>) => request(`/api/admin/categories/${category.id}/products`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, includeInside: true, ...extra }) });
    const preview = await (await call({ dryRun: true })).json().catch(() => ({} as { count?: number; categories?: string[]; sample?: string[]; error?: string }));
    if (!preview.count) { setMessage(preview.error ?? `“${category.name}” has no products to ${mode === "archive" ? "hide" : "delete"}.`); return; }
    const where = (preview.categories ?? []).length > 1 ? ` in “${category.name}” and the categories inside it (${(preview.categories ?? []).join(", ")})` : ` in “${category.name}”`;
    let confirmName = "";
    if (mode === "archive") {
      if (!window.confirm(`Hide ${preview.count} product${preview.count === 1 ? "" : "s"}${where} from the website?

They are kept and can be shown again later.`)) return;
    } else {
      const typed = window.prompt(`DELETE FOR GOOD ${preview.count} product${preview.count === 1 ? "" : "s"}${where}, with their sizes and pictures?
This cannot be undone. Past orders are not affected.

Examples: ${(preview.sample ?? []).join(", ")}

To continue, type the category name: ${category.name}`);
      if (typed === null) return;
      confirmName = typed;
    }
    let done = 0;
    for (let round = 0; round < 200; round += 1) {
      const response = await call({ confirmName });
      const result = await response.json().catch(() => ({} as { done?: number; remaining?: number; error?: string }));
      if (!response.ok) { setMessage(result.error ?? "Could not finish. Press the button again to continue."); await refreshCategories(); return; }
      done += result.done ?? 0;
      setMessage(`${mode === "archive" ? "Hidden" : "Deleted"} ${done} of ${preview.count}…`);
      if (!result.remaining) break;
    }
    setMessage(`${mode === "archive" ? "Hidden" : "Deleted"} ${done} product${done === 1 ? "" : "s"}${where}.`);
    await refreshCategories();
  }

  /** Saves a size chart picture for a category (kept whole, not cropped) and refreshes the list. */
  async function uploadSizeChart(category: Category, file: File | null) {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    setImageBusyId(category.id);
    try {
      const response = await request(`/api/admin/categories/${category.id}/size-chart`, { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      setMessage(response.ok ? `Size chart saved for “${category.name}”.` : result.error ?? "The size chart could not be saved.");
      if (response.ok) await refreshCategories();
    } finally {
      setImageBusyId(null);
    }
  }

  async function removeSizeChart(category: Category) {
    if (!window.confirm(`Remove the size chart of “${category.name}”?`)) return;
    const response = await request(`/api/admin/categories/${category.id}/size-chart`, { method: "DELETE" });
    setMessage(response.ok ? "Size chart removed." : "The size chart could not be removed.");
    if (response.ok) await refreshCategories();
  }

  /** Removes an empty category for good (the server refuses while it has products or categories inside it, and says why). */
  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete the category “${category.name}” for good?

It disappears from the shop and from this list, with its pictures. This cannot be undone. It only works when the category has no products and no categories inside it.`)) return;
    const response = await request(`/api/admin/categories/${category.id}?permanent=true`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? `“${category.name}” was deleted.` : result.error ?? "Could not delete the category.");
    if (response.ok) { setOpenId(null); await refreshCategories(); }
  }

  /** Puts a hidden category back in the shop menu. */
  async function showInMenu(category: Category) {
    const response = await request(`/api/admin/categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? `“${category.name}” is now shown in the menu.` : result.error ?? "Could not show the category.");
    if (response.ok) await refreshCategories();
  }

  return (
    <section className="admin-main">
      <header className="admin-topbar">
        <div>
          <h1>Categories</h1>
          <p className="a-muted" style={{ marginTop: 5, maxWidth: 680 }}>
            <strong>Categories</strong> are the groups customers shop by, like Shirts or Pants. A category can have categories inside it, like Formal Shirts inside Shirts.
          </p>
        </div>
        <div className="admin-top-actions">
          <Link href="/admin/products">← Products</Link>
        </div>
      </header>


      {(
        <div className="collection-manager">
          <section>
            <div className="admin-table-card">
              <div className="admin-table-tools">
                <div>
                  <h2>Categories</h2>
                  <span>{categories.length} categories. Press one to open it and change it.</span>
                </div>
                <input type="search" className="cat-find" placeholder="Find a category…" aria-label="Find a category" value={find} onChange={(event) => setFind(event.target.value)} />
              </div>
              <div className="admin-table-wrap">
                <div className="cat-list">
                  {shown.map((category) => {
                    const open = openId === category.id;
                    const hidden = category.status !== "active";
                    const busy = imageBusyId === category.id;
                    return (
                      <article className={`cat-card${hidden ? " is-hidden" : ""}`} key={category.id} style={{ marginInlineStart: Math.min(category.depth, 5) * 20 }}>
                        <header className="cat-card-head is-toggle" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpenId(open ? null : category.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenId(open ? null : category.id); } }}>
                          <div>
                            <h3>{category.name}</h3>
                            {category.depth > 0 && <small className="category-trail">Inside: {category.path.slice(0, -1).join(" › ")}</small>}
                          </div>
                          <div className="cat-badges">
                            <span className={`cat-badge ${hidden ? "off" : "on"}`}>{hidden ? "Not in the shop menu" : "Shown in the shop menu"}</span>
                            <span className="cat-badge">{category.liveProducts} product{category.liveProducts === 1 ? "" : "s"} on the website</span>
                            <span className="cat-chevron" aria-hidden="true">{open ? "▲" : "▼"}</span>
                          </div>
                        </header>
                        {hidden && category.liveProducts > 0 && (
                          <div className="cat-warn" role="alert">
                            <span>This category is hidden, so shoppers cannot find its {category.liveProducts} product{category.liveProducts === 1 ? "" : "s"} in the menu.</span>
                            <button type="button" className="admin-primary" onClick={() => void showInMenu(category)}>Show it in the menu</button>
                          </div>
                        )}
                        {open && (<>
                        <form className="cat-form" onSubmit={(event) => saveCategory(event, category.id)}>
                          <label>
                            <span>Name</span>
                            <small>What shoppers see in the menu.</small>
                            <input name="name" defaultValue={category.name} required />
                          </label>
                          <label>
                            <span>Shown in the shop menu?</span>
                            <small>“No” hides the category from the menu. Its products stay on the website.</small>
                            <select name="status" defaultValue={category.status}>
                              <option value="active">Yes, shown</option>
                              <option value="inactive">No, hidden</option>
                            </select>
                          </label>
                          <label>
                            <span>Card on the home page?</span>
                            <small>“No” keeps it off the home page cards only. It stays in the side menu, the shop and its own page.</small>
                            <select name="showOnHome" defaultValue={category.showOnHome ? "true" : "false"}>
                              <option value="true">Yes, show a card</option>
                              <option value="false">No, not on the home page</option>
                            </select>
                          </label>
                          <label>
                            <span>Inside which category?</span>
                            <small>Example: “Formal Shirts” goes inside “Shirts”. “Top level” puts it in the main menu.</small>
                            <select name="parentId" defaultValue={category.parentId ?? ""}>
                              <option value="">Top level (main menu)</option>
                              {tree.filter((other) => !blocked(category.id).has(other.id) && other.depth + 1 < MAX_DEPTH).map((other) => (
                                <option key={other.id} value={other.id}>{pathLabel(other.path)}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Position in the menu</span>
                            <small>The smaller number comes first: 0, 1, 2…</small>
                            <input name="sortOrder" type="number" min="0" defaultValue={category.sortOrder} />
                          </label>
                          <label>
                            <span>Web address</span>
                            <small>Shown as /collections/<strong>{category.slug}</strong>. Change only if you must: old links stop working.</small>
                            <input name="slug" defaultValue={category.slug} required />
                          </label>
                          <label>
                            <span>Short description (optional)</span>
                            <small>A line shown at the top of the category page.</small>
                            <input name="description" defaultValue={category.description ?? ""} />
                          </label>
                          <div className="cat-actions"><button className="admin-primary">Save changes</button></div>
                        </form>
                        <div className="cat-photos">
                          <h4>Pictures</h4>
                          <div className="cat-photo-row">
                            <div className="category-photo-slot">
                              <span className="category-photo-preview category-photo-preview-card">
                                {category.imageUrl ? <Image src={category.imageUrl} alt="" fill sizes="90px" /> : <i aria-hidden="true">No picture yet</i>}
                              </span>
                              <small>Card picture (tall)</small>
                              <small className="muted">Shown on the home page tile.</small>
                              {category.imageUrl && <button type="button" disabled={busy} onClick={() => removeCategoryImage(category, "card")}>Remove</button>}
                            </div>
                          </div>
                          {photoEditId === category.id ? (
                            <div className="category-photo-editor">
                              <div className="category-photo-slot">
                                <span className="category-photo-preview category-photo-preview-card">
                                  {cardSlot.previewUrl ? <Image src={cardSlot.previewUrl} alt="" fill unoptimized sizes="90px" /> : <i aria-hidden="true">New card picture</i>}
                                </span>
                                <FilePick name={cardSlot.file?.name} onPick={(file) => pickPhoto("card", file)} />
                              </div>
                              <div className="cat-actions">
                                <button type="button" className="admin-primary" disabled={busy || (!cardSlot.crop && !heroSlot.crop)} onClick={() => saveCategoryPhotos(category)}>{busy ? "Saving…" : "Save pictures"}</button>
                                <button type="button" disabled={busy} onClick={cancelPhotoEdit}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => startPhotoEdit(category.id)}>Change pictures</button>
                          )}
                        </div>
                        <div className="cat-chart">
                          <strong>Size chart picture</strong>
                          <small>Shoppers see it when they press “Size guide” on a product of this category and of the categories inside it. A sub-category can have its own picture.</small>
                          <div className="cat-chart-row">
                            <span className="cat-chart-preview">
                              {category.sizeChartUrl ? <Image src={category.sizeChartUrl} alt="" fill unoptimized sizes="160px" /> : <i aria-hidden="true">No chart yet</i>}
                            </span>
                            <div className="cat-actions">
                              <FilePick name={undefined} onPick={(file) => void uploadSizeChart(category, file)} />
                              {category.sizeChartUrl && <button type="button" disabled={busy} onClick={() => void removeSizeChart(category)}>Remove chart</button>}
                            </div>
                          </div>
                        </div>
                        <div className="cat-danger">
                          <small>Starting again with this category? Remove all its products at once (the categories inside it are included).</small>
                          <div className="cat-actions">
                            <button type="button" onClick={() => void clearCategoryProducts(category, "archive")}>Hide all its products</button>
                            <button type="button" className="admin-danger" onClick={() => void clearCategoryProducts(category, "delete")}>Delete all its products for good</button>
                          </div>
                        </div>
                        <div className="cat-danger">
                          <small>Made by mistake, or twice? An empty category (no products, nothing inside) can be removed completely.</small>
                          <div className="cat-actions">
                            <button type="button" className="admin-danger" onClick={() => void deleteCategory(category)}>Delete this category</button>
                          </div>
                        </div>
                        </>)}
                      </article>
                    );
                  })}
                </div>
                {!categories.length && (
                  <div className="admin-empty">
                    <h3>No categories yet</h3>
                    <p>Add your first category to organize products.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
          <form className="campaign-upload" onSubmit={createCategory}>
            <p className="eyebrow">New category</p>
            <h2>Create category</h2>
            <label>
              <span>Name</span>
              <input required name="name" placeholder="Eid Edit" />
            </label>
            <label>
              <span>Inside category (optional)</span>
              <select name="parentId" defaultValue="">
                <option value="">Top level (not inside another)</option>
                {tree.filter((other) => other.depth + 1 < MAX_DEPTH).map((other) => (
                  <option key={other.id} value={other.id}>{pathLabel(other.path)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>URL slug (optional)</span>
              <input name="slug" placeholder="eid-edit" />
            </label>
            <label>
              <span>Description</span>
              <textarea name="description" rows={3} />
            </label>
            <label>
              <span>Sequence</span>
              <input type="number" min="0" name="sortOrder" defaultValue={categories.length} />
            </label>
            <button className="admin-primary">Create category</button>
          </form>
        </div>
      )}
      {cropTarget && (cropTarget === "card" ? cardSlot.file : heroSlot.file) && (
        <ImageCropper
          file={(cropTarget === "card" ? cardSlot.file : heroSlot.file) as File}
          aspect={cropTarget === "card" ? CARD_ASPECT : HERO_ASPECT}
          label={cropTarget === "card" ? "Crop card photo (3:4)" : "Crop hero photo (wide banner)"}
          onConfirm={confirmPhotoCrop}
          onCancel={() => setCropTarget(null)}
        />
      )}
    </section>
  );
}
