"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { cropImageClientSide, processImageClientSide } from "@/lib/client-image-processing";
import { ImageCropper } from "../campaign/image-cropper";
import { descendantIds, flattenTree, pathLabel } from "@/lib/category-tree";

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
                <table>
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Name</th>
                      <th>Inside</th>
                      <th>Slug</th>
                      <th>Subcategories</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Order</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tree.map((category) => (
                      <tr key={category.id}>
                        <td>
                          <div className="category-photo-cell">
                            <div className="category-photo-slot">
                              <span className="category-photo-preview category-photo-preview-card">
                                {category.imageUrl ? <Image src={category.imageUrl} alt="" fill sizes="60px" /> : <i aria-hidden="true">◇</i>}
                              </span>
                              <small>Card 3:4</small>
                              {category.imageUrl && (
                                <button type="button" disabled={imageBusyId === category.id} onClick={() => removeCategoryImage(category, "card")}>
                                  Remove
                                </button>
                              )}
                            </div>
                            <div className="category-photo-slot">
                              <span className="category-photo-preview category-photo-preview-hero">
                                {category.heroImageUrl ? <Image src={category.heroImageUrl} alt="" fill sizes="90px" /> : <i aria-hidden="true">◇</i>}
                              </span>
                              <small>Hero wide</small>
                              {category.heroImageUrl && (
                                <button type="button" disabled={imageBusyId === category.id} onClick={() => removeCategoryImage(category, "hero")}>
                                  Remove
                                </button>
                              )}
                            </div>
                            {photoEditId === category.id ? (
                              <button type="button" disabled={imageBusyId === category.id} onClick={cancelPhotoEdit}>
                                Cancel
                              </button>
                            ) : (
                              <button type="button" disabled={imageBusyId === category.id} onClick={() => startPhotoEdit(category.id)}>
                                Change photos
                              </button>
                            )}
                          </div>
                          {photoEditId === category.id && (
                            <div className="category-photo-editor">
                              <div className="category-photo-slot">
                                <span className="category-photo-preview category-photo-preview-card">
                                  {cardSlot.previewUrl ? (
                                    <Image src={cardSlot.previewUrl} alt="" fill unoptimized sizes="60px" />
                                  ) : (
                                    <i aria-hidden="true">◇</i>
                                  )}
                                </span>
                                <small>New card (3:4)</small>
                                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={(event) => pickPhoto("card", event.target.files?.[0] ?? null)} />
                              </div>
                              <div className="category-photo-slot">
                                <span className="category-photo-preview category-photo-preview-hero">
                                  {heroSlot.previewUrl ? (
                                    <Image src={heroSlot.previewUrl} alt="" fill unoptimized sizes="90px" />
                                  ) : (
                                    <i aria-hidden="true">◇</i>
                                  )}
                                </span>
                                <small>New hero (wide)</small>
                                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={(event) => pickPhoto("hero", event.target.files?.[0] ?? null)} />
                              </div>
                              <button
                                type="button"
                                className="admin-primary"
                                disabled={imageBusyId === category.id || (!cardSlot.crop && !heroSlot.crop)}
                                onClick={() => saveCategoryPhotos(category)}
                              >
                                {imageBusyId === category.id ? "Saving…" : "Save photos"}
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <input form={`category-${category.id}`} name="name" defaultValue={category.name} aria-label="Name" style={{ marginInlineStart: Math.min(category.depth, 5) * 18 }} />
                          {category.depth > 0 && <small className="category-trail">{category.path.slice(0, -1).join(" › ")}</small>}
                        </td>
                        <td>
                          <select form={`category-${category.id}`} name="parentId" defaultValue={category.parentId ?? ""} aria-label="Inside category">
                            <option value="">Top level</option>
                            {tree.filter((other) => !blocked(category.id).has(other.id)).map((other) => (
                              <option key={other.id} value={other.id}>{pathLabel(other.path)}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input form={`category-${category.id}`} name="slug" defaultValue={category.slug} aria-label="Slug" />
                        </td>
                        <td>
                          <input
                            form={`category-${category.id}`}
                            name="subcategories"
                            defaultValue={category.subcategories ?? ""}
                            placeholder="Casual, Festive, Embroidered"
                            aria-label="Subcategories"
                            style={{ minWidth: 160 }}
                          />
                        </td>
                        <td>
                          <input
                            form={`category-${category.id}`}
                            name="description"
                            defaultValue={category.description ?? ""}
                            aria-label="Description"
                          />
                        </td>
                        <td>
                          <select form={`category-${category.id}`} name="status" defaultValue={category.status}>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </td>
                        <td>
                          <input
                            form={`category-${category.id}`}
                            name="sortOrder"
                            type="number"
                            min="0"
                            defaultValue={category.sortOrder}
                            style={{ width: 60 }}
                            aria-label="Order"
                          />
                        </td>
                        <td>
                          <button form={`category-${category.id}`}>Save</button>
                          {/* This empty form carries no visible fields of its own — every input above
                              targets it via the HTML `form` attribute, since a <form> cannot be a
                              valid child of <tr> in table markup. */}
                          <form id={`category-${category.id}`} onSubmit={(event) => saveCategory(event, category.id)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                {tree.map((other) => (
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
