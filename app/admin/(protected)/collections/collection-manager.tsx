"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cropImageClientSide, processImageClientSide } from "@/lib/client-image-processing";
import { ImageCropper } from "../campaign/image-cropper";
import { descendantIds, flattenTree, MAX_DEPTH, pathLabel } from "@/lib/category-tree";

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

type Product = { id: string; name: string; slug: string; status: string };
type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  subcategories: string | null;
  parentId: string | null;
  status: string;
  sortOrder: number;
  imageUrl: string | null;
  heroImageUrl: string | null;
  /** How many published products sit in this category. */
  liveProducts: number;
};
type Collection = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  sortOrder: number;
  productCount: number;
};
type Assignment = { collectionId: string; productId: string };

export function CollectionManager({ products }: { products: Product[] }) {
  const [tab, setTab] = useState<"collections" | "categories">("collections");
  const [categories, setCategories] = useState<Category[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selected, setSelected] = useState<Collection | null>(null);
  const [message, setMessage] = useState("");
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
    const response = await fetch("/api/admin/categories", { cache: "no-store" });
    if (response.ok) setCategories((await response.json()).categories);
  }, []);
  const refreshCollections = useCallback(async () => {
    const response = await fetch("/api/admin/collections", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      setCollections(data.collections);
      setAssignments(data.assignments);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshCategories();
      void refreshCollections();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshCategories, refreshCollections]);

  // The categories as a folder tree: parents first, each followed by what is inside it.
  const tree = useMemo(() => flattenTree(categories), [categories]);
  /** A category cannot be put inside itself or inside one of its own categories. */
  const blocked = (id: string) => new Set(descendantIds(categories, id));

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { ...Object.fromEntries(new FormData(event.currentTarget)), parentId: new FormData(event.currentTarget).get("parentId") || null };
    const response = await fetch("/api/admin/categories", {
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
      const response = await fetch(`/api/admin/categories/${category.id}/image`, { method: "POST", body: form });
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
      const response = await fetch(`/api/admin/categories/${category.id}/image${target === "hero" ? "?target=hero" : ""}`, {
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
    const body = { ...Object.fromEntries(new FormData(event.currentTarget)), parentId: new FormData(event.currentTarget).get("parentId") || null };
    const response = await fetch(`/api/admin/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Category updated." : result.error ?? "Category could not be updated.");
    if (response.ok) await refreshCategories();
  }

  /** Puts a hidden category back in the shop menu. */
  async function showInMenu(category: Category) {
    const response = await fetch(`/api/admin/categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? `“${category.name}” is now shown in the menu.` : result.error ?? "Could not show the category.");
    if (response.ok) await refreshCategories();
  }

  async function createCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/admin/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setMessage(response.ok ? "Collection created." : result.error ?? "Collection could not be created.");
    if (response.ok) {
      event.currentTarget.reset();
      await refreshCollections();
    }
  }

  async function saveCollectionMeta(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/admin/collections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMessage(response.ok ? "Collection updated." : "Collection could not be updated.");
    if (response.ok) await refreshCollections();
  }

  async function saveProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const productIds = new FormData(event.currentTarget).getAll("productId");
    const response = await fetch(`/api/admin/collections/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds }),
    });
    setMessage(response.ok ? "Collection products updated." : "Collection could not be updated.");
    if (response.ok) await refreshCollections();
  }

  return (
    <section className="admin-main">
      <header className="admin-topbar">
        <div>
          <h1>Categories</h1>
          <p className="a-muted" style={{ marginTop: 5, maxWidth: 680 }}>
            <strong>Categories</strong> are the groups customers shop by, like Shirts or Pants. <strong>Collections</strong> are hand-picked lists you create for a season or event, like “Eid Edit”.
          </p>
        </div>
        <div className="admin-top-actions">
          <Link href="/admin/products">← Products</Link>
          <button className={tab === "collections" ? "active" : ""} onClick={() => setTab("collections")}>
            Collections
          </button>
          <button className={tab === "categories" ? "active" : ""} onClick={() => setTab("categories")}>
            Categories
          </button>
        </div>
      </header>

      {message && (
        <div className="admin-message" role="status">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}

      {tab === "categories" ? (
        <div className="collection-manager">
          <section>
            <div className="admin-table-card">
              <div className="admin-table-tools">
                <div>
                  <h2>Categories</h2>
                  <span>{categories.length} categories</span>
                </div>
              </div>
              <div className="admin-table-wrap">
                <div className="cat-list">
                  {tree.map((category) => {
                    const hidden = category.status !== "active";
                    const busy = imageBusyId === category.id;
                    return (
                      <article className={`cat-card${hidden ? " is-hidden" : ""}`} key={category.id} style={{ marginInlineStart: Math.min(category.depth, 5) * 20 }}>
                        <header className="cat-card-head">
                          <div>
                            <h3>{category.name}</h3>
                            {category.depth > 0 && <small className="category-trail">Inside: {category.path.slice(0, -1).join(" › ")}</small>}
                          </div>
                          <div className="cat-badges">
                            <span className={`cat-badge ${hidden ? "off" : "on"}`}>{hidden ? "Not in the shop menu" : "Shown in the shop menu"}</span>
                            <span className="cat-badge">{category.liveProducts} product{category.liveProducts === 1 ? "" : "s"} on the website</span>
                          </div>
                        </header>
                        {hidden && category.liveProducts > 0 && (
                          <div className="cat-warn" role="alert">
                            <span>This category is hidden, so shoppers cannot find its {category.liveProducts} product{category.liveProducts === 1 ? "" : "s"} in the menu.</span>
                            <button type="button" className="admin-primary" onClick={() => void showInMenu(category)}>Show it in the menu</button>
                          </div>
                        )}
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
                          <label>
                            <span>Quick groups (optional)</span>
                            <small>Words shown under this category, separated by commas. Example: Casual, Festive.</small>
                            <input name="subcategories" defaultValue={category.subcategories ?? ""} />
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
                            <div className="category-photo-slot is-wide">
                              <span className="category-photo-preview category-photo-preview-hero">
                                {category.heroImageUrl ? <Image src={category.heroImageUrl} alt="" fill sizes="180px" /> : <i aria-hidden="true">No picture yet</i>}
                              </span>
                              <small>Wide banner picture</small>
                              <small className="muted">Shown at the top of the category page.</small>
                              {category.heroImageUrl && <button type="button" disabled={busy} onClick={() => removeCategoryImage(category, "hero")}>Remove</button>}
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
                              <div className="category-photo-slot is-wide">
                                <span className="category-photo-preview category-photo-preview-hero">
                                  {heroSlot.previewUrl ? <Image src={heroSlot.previewUrl} alt="" fill unoptimized sizes="180px" /> : <i aria-hidden="true">New wide picture</i>}
                                </span>
                                <FilePick name={heroSlot.file?.name} onPick={(file) => pickPhoto("hero", file)} />
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
              <span>Subcategories (comma separated)</span>
              <input name="subcategories" placeholder="Casual, Festive, Embroidered" />
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
      ) : (
        <div className="collection-manager">
          <section>
            <div className="admin-table-card">
              <div className="admin-table-tools">
                <div>
                  <h2>Your catalogues</h2>
                  <span>{collections.length} collections</span>
                </div>
              </div>
              {collections.map((collection) => (
                <button key={collection.id} className={selected?.id === collection.id ? "active" : ""} onClick={() => setSelected(collection)}>
                  <div>
                    <strong>{collection.name}</strong>
                    <small>/collections/{collection.slug}</small>
                  </div>
                  <span>{collection.productCount} pieces</span>
                </button>
              ))}
            </div>
            {selected && (
              <>
                <form key={`${selected.id}-meta`} className="admin-settings-card" onSubmit={(event) => saveCollectionMeta(event, selected.id)}>
                  <div className="admin-form-grid">
                    <label>
                      <span>Name</span>
                      <input name="name" defaultValue={selected.name} />
                    </label>
                    <label>
                      <span>Slug</span>
                      <input name="slug" defaultValue={selected.slug} />
                    </label>
                    <label className="field-wide">
                      <span>Description</span>
                      <textarea name="description" rows={3} defaultValue={selected.description ?? ""} />
                    </label>
                    <label>
                      <span>Status</span>
                      <select name="status" defaultValue={selected.status}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                    <label>
                      <span>Sequence</span>
                      <input type="number" min="0" name="sortOrder" defaultValue={selected.sortOrder} />
                    </label>
                  </div>
                  <button className="admin-primary">Save collection details</button>
                </form>
                <form key={selected.id} className="collection-products" onSubmit={saveProducts}>
                  <p className="eyebrow">{selected.name}</p>
                  <h2>Included products</h2>
                  {products.map((product) => (
                    <label key={product.id}>
                      <input
                        type="checkbox"
                        name="productId"
                        value={product.id}
                        defaultChecked={assignments.some((entry) => entry.collectionId === selected.id && entry.productId === product.id)}
                      />
                      <span>
                        {product.name}
                        <small>{product.status}</small>
                      </span>
                    </label>
                  ))}
                  <button className="admin-primary">Save product selection</button>
                </form>
              </>
            )}
          </section>
          <form className="campaign-upload" onSubmit={createCollection}>
            <p className="eyebrow">New catalogue</p>
            <h2>Create collection</h2>
            <label>
              <span>Name</span>
              <input required name="name" placeholder="The Evening Edit" />
            </label>
            <label>
              <span>URL slug (optional)</span>
              <input name="slug" placeholder="evening-edit" />
            </label>
            <label>
              <span>Description</span>
              <textarea name="description" rows={4} />
            </label>
            <label>
              <span>Sequence</span>
              <input type="number" min="0" name="sortOrder" defaultValue={collections.length} />
            </label>
            <button className="admin-primary">Create collection</button>
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
