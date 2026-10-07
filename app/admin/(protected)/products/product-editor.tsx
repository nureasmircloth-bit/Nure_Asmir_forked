"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACCEPTED_PICTURES, checkPictureFile, uploadProductPicture } from "@/lib/client-upload";
import { mediaUrl } from "@/lib/media-url";
import { suggestSku } from "@/lib/sku";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, Dialog, Hint, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { pkr } from "../../_ui/ui";
import { ProductPreview, type PreviewData } from "./product-preview";
import { SeoPanel, type SeoDraft } from "./seo-panel";

export type EditorCategory = { id: string; name: string };
export type EditorProduct = {
  id: string;
  name: string;
  categoryId: string;
  typeLabel: string;
  primaryColour: string;
  material: string;
  shortDescription: string;
  description: string;
  careInstructions: string;
  status: "draft" | "published" | "archived";
  featured: boolean;
  badge: string;
  /** Drafted automatically when the product is saved; shown only in the Google preview. */
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string | null;
  seoLocked?: boolean;
};
export type EditorVariantRow = { id: string; color: string; size: string; sku: string; price: number; compareAtPrice: number | null; stockQuantity: number; reservedQuantity: number; lowStockThreshold: number };
export type EditorImageRow = { id: string; variantId: string | null; r2Key: string; variantWidths: number[] | null; isPrimary: boolean; sortOrder: number; altText: string };

type VariantDraft = { key: string; id?: string; size: string; sku: string; skuTouched: boolean; price: string; compareAt: string; stock: string; low: string; reserved: number };
/** The first photo of a colour is its main photo, so a photo only needs to remember its place in the list. */
type PhotoDraft = { key: string; id?: string; url: string; file?: File; variantId?: string | null };
/** One colour of the product: its own name, sizes (with prices and stock) and photos. */
type ColorDraft = { key: string; name: string; variants: VariantDraft[]; photos: PhotoDraft[] };

const TYPES = ["Shalwar Kameez", "Kurta", "Shirt", "T-Shirt", "Polo Shirt", "Pants", "Cargo Pants", "Jeans", "Waistcoat", "Sweater", "Hoodie", "Wallet", "Belt", "Card Holder", "Cap", "Socks"];
const TEXT_SIZES = ["S", "M", "L", "XL", "XXL"];
const WAIST_SIZES = ["28", "30", "32", "34", "36", "38"];
const BADGES = ["", "New", "Sale", "Bestseller", "Limited"];

let counter = 0;
const uid = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Turns the saved variants and photos into one editable block per colour (sizes + photos together). */
function buildColors(primaryColour: string, variants: EditorVariantRow[] | undefined, images: EditorImageRow[] | undefined): ColorDraft[] {
  const draftOf = (v: EditorVariantRow): VariantDraft => ({ key: v.id, id: v.id, size: v.size, sku: v.sku, skuTouched: true, price: String(v.price), compareAt: v.compareAtPrice ? String(v.compareAtPrice) : "", stock: String(v.stockQuantity), low: String(v.lowStockThreshold), reserved: v.reservedQuantity });
  const colors: ColorDraft[] = [];
  for (const v of variants ?? []) {
    const name = v.color.trim() || primaryColour.trim();
    let color = colors.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!color) {
      color = { key: uid(), name, variants: [], photos: [] };
      colors.push(color);
    }
    color.variants.push(draftOf(v));
  }
  if (!colors.length) {
    colors.push({ key: uid(), name: primaryColour, photos: [], variants: [{ key: uid(), size: "", sku: "", skuTouched: false, price: "", compareAt: "", stock: "0", low: "3", reserved: 0 }] });
  }
  const sorted = [...(images ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);
  for (const image of sorted) {
    // A photo shared by the whole product (no colour) is shown under the first colour so nothing is lost.
    const owner = colors.find((c) => c.variants.some((v) => v.id === image.variantId)) ?? colors[0];
    owner.photos.push({ key: image.id, id: image.id, url: mediaUrl(image.r2Key, image.variantWidths), variantId: image.variantId });
  }
  return colors;
}

export function ProductEditor({ categories, product, variants: initialVariants, images: initialImages }: { categories: EditorCategory[]; product?: EditorProduct; variants?: EditorVariantRow[]; images?: EditorImageRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const saver = useLockedAction();
  const writer = useLockedAction();
  const isNew = !product;

  const [form, setForm] = useState({
    name: product?.name ?? "",
    categoryId: product?.categoryId ?? categories[0]?.id ?? "",
    typeLabel: product?.typeLabel ?? "",
    material: product?.material ?? "",
    shortDescription: product?.shortDescription ?? "",
    description: product?.description ?? "",
    careInstructions: product?.careInstructions ?? "",
    status: (product?.status ?? "published") as "draft" | "published" | "archived",
    featured: product?.featured ?? false,
    badge: product?.badge ?? "",
  });
  const [seo, setSeo] = useState<SeoDraft>(() => ({ title: product?.seoTitle ?? "", description: product?.seoDescription ?? "", keywords: product?.seoKeywords ?? "", edited: false, locked: product?.seoLocked ?? false }));
  const [writingSeo, setWritingSeo] = useState(false);
  const [colors, setColors] = useState<ColorDraft[]>(() => buildColors(product?.primaryColour ?? "", initialVariants, initialImages));
  const [active, setActive] = useState(0);
  const [removedVariants, setRemovedVariants] = useState<string[]>([]);
  const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
  const [adding, setAdding] = useState<{ name: string; from: string } | null>(null);
  const [removingColor, setRemovingColor] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [over, setOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Local blob previews are released when a picture is removed or the page closes.
  const blobUrls = useRef<string[]>([]);
  useEffect(() => () => blobUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const touch = useCallback(() => setDirty(true), []);
  const setField = (name: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [name]: event.target.value }));
    touch();
  };

  const multi = colors.length > 1;
  const current = colors[Math.min(active, colors.length - 1)];
  const variants = current.variants;
  const photos = current.photos;
  const mapCurrent = (change: (color: ColorDraft) => ColorDraft) => setColors((all) => all.map((c) => (c.key === current.key ? change(c) : c)));

  /* ---------------------------------- photos ---------------------------------- */
  function addFiles(list: FileList | File[]) {
    const problems: string[] = [];
    const next: PhotoDraft[] = [];
    for (const file of Array.from(list)) {
      const problem = checkPictureFile(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const url = URL.createObjectURL(file);
      blobUrls.current.push(url);
      next.push({ key: uid(), url, file });
    }
    if (problems.length) toast(problems[0] + (problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""), "bad");
    if (!next.length) return;
    mapCurrent((c) => ({ ...c, photos: [...c.photos, ...next].slice(0, 12) }));
    touch();
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    addFiles(event.dataTransfer.files);
  };
  const makeMain = (key: string) => {
    mapCurrent((c) => {
      const picked = c.photos.find((p) => p.key === key);
      return picked ? { ...c, photos: [picked, ...c.photos.filter((p) => p.key !== key)] } : c;
    });
    touch();
  };
  const movePhoto = (key: string, delta: -1 | 1) => {
    mapCurrent((c) => {
      const index = c.photos.findIndex((p) => p.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= c.photos.length) return c;
      const copy = [...c.photos];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return { ...c, photos: copy };
    });
    touch();
  };
  const removePhoto = (photo: PhotoDraft) => {
    if (photo.id) setRemovedPhotos((all) => [...all, photo.id as string]);
    mapCurrent((c) => ({ ...c, photos: c.photos.filter((p) => p.key !== photo.key) }));
    touch();
  };

  /* --------------------------------- variants --------------------------------- */
  const blankVariant = (): VariantDraft => ({ key: uid(), size: "", sku: "", skuTouched: false, price: "", compareAt: "", stock: "0", low: "3", reserved: 0 });
  const updateVariant = (key: string, patch: Partial<VariantDraft>) => {
    mapCurrent((c) => ({ ...c, variants: c.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
    touch();
  };
  const addSizes = (sizes: string[]) => {
    mapCurrent((c) => {
      const have = new Set(c.variants.map((v) => v.size.toLowerCase()));
      const base = c.variants.find((v) => v.price) ?? c.variants[0];
      // Replace the single empty starter row instead of leaving a blank row above the new sizes.
      const start = c.variants.length === 1 && !c.variants[0].size && !c.variants[0].sku ? [] : c.variants;
      const fresh = sizes.filter((size) => !have.has(size.toLowerCase())).map((size) => ({ ...blankVariant(), size, price: base?.price ?? "", compareAt: base?.compareAt ?? "" }));
      return { ...c, variants: [...start, ...fresh] };
    });
    touch();
  };
  const removeVariant = (v: VariantDraft) => {
    if (v.id) setRemovedVariants((all) => [...all, v.id as string]);
    mapCurrent((c) => ({ ...c, variants: c.variants.length === 1 ? [blankVariant()] : c.variants.filter((x) => x.key !== v.key) }));
    touch();
  };
  const resolved = useMemo(
    () => colors.map((c) => ({ ...c, variants: c.variants.map((v) => ({ ...v, sku: v.skuTouched || v.id ? v.sku : suggestSku(form.name, form.typeLabel, v.size, colors.length > 1 ? c.name : "") })) })),
    [colors, form.name, form.typeLabel],
  );
  const withSkus = resolved[Math.min(active, resolved.length - 1)].variants;

  /* ---------------------------------- colours ---------------------------------- */
  const renameColor = (name: string) => {
    mapCurrent((c) => ({ ...c, name }));
    touch();
  };
  function addColor() {
    if (!adding) return;
    const name = adding.name.trim();
    if (!name) {
      toast("Please type the new colour, for example Navy.", "bad");
      return;
    }
    if (colors.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      toast(`You already have ${name}.`, "bad");
      return;
    }
    // The old colour's sizes, prices and low-stock alerts come along so nothing is typed twice – stock starts at 0 for the new colour.
    const source = colors.find((c) => c.key === adding.from) ?? current;
    const copied = source.variants.map<VariantDraft>((v) => ({ ...blankVariant(), size: v.size, price: v.price, compareAt: v.compareAt, low: v.low }));
    setColors((all) => [...all, { key: uid(), name, variants: copied.length ? copied : [blankVariant()], photos: [] }]);
    setActive(colors.length);
    setAdding(null);
    touch();
  }
  function removeColor() {
    if (colors.length < 2) return;
    setRemovedVariants((all) => [...all, ...current.variants.flatMap((v) => (v.id ? [v.id] : []))]);
    setRemovedPhotos((all) => [...all, ...current.photos.flatMap((p) => (p.id ? [p.id] : []))]);
    setColors((all) => all.filter((c) => c.key !== current.key));
    setActive((index) => Math.max(0, index - 1));
    setRemovingColor(false);
    touch();
  }

  /* ----------------------------------- AI text ---------------------------------- */
  async function writeText(mode: "write" | "rewrite") {
    if (!form.name.trim()) {
      toast("Please type the product name first — the helper needs it.", "bad");
      return;
    }
    await writer.run(async () => {
      const categoryName = categories.find((c) => c.id === form.categoryId)?.name;
      const result = await callApi<{ description: string }>("/api/admin/ai-description", "POST", { name: form.name, type: form.typeLabel, category: categoryName, color: colors.map((c) => c.name.trim()).filter(Boolean).join(", "), material: form.material, existing: form.description, mode });
      if (result.ok) {
        setForm((current) => ({ ...current, description: result.data.description }));
        touch();
        toast(mode === "rewrite" ? "Done. Please read it, and change anything you like." : "Written. Please read it, and change anything you like.", "good");
      } else toast(result.error, "bad");
    });
  }

  async function writeSeo() {
    if (!form.name.trim()) return;
    setWritingSeo(true);
    try {
      const categoryName = categories.find((c) => c.id === form.categoryId)?.name;
      const result = await callApi<{ seoTitle: string; seoDescription: string }>("/api/admin/ai-seo", "POST", { name: form.name, type: form.typeLabel, category: categoryName, color: colors.map((c) => c.name.trim()).filter(Boolean).join(", "), material: form.material, shortDescription: form.shortDescription, description: form.description, keywords: seo.keywords });
      if (result.ok) {
        setSeo((current) => ({ ...current, title: result.data.seoTitle, description: result.data.seoDescription, edited: true }));
        touch();
        toast("Written. Read it, change anything you like, then save the product.", "good");
      } else toast(result.error, "bad");
    } finally {
      setWritingSeo(false);
    }
  }

  /* ------------------------------------ save ------------------------------------ */
  function validate(): string[] {
    const problems: string[] = [];
    if (!form.name.trim()) problems.push("Please type the product name.");
    if (!form.categoryId) problems.push("Please choose a category (create one first under Categories).");
    if (!form.typeLabel.trim()) problems.push("Please say what kind of product it is, for example Shirt or Pants.");
    const names = new Set<string>();
    resolved.forEach((c, colorIndex) => {
      const where = multi ? `${c.name.trim() || `Colour ${colorIndex + 1}`}: ` : "";
      if (!c.name.trim()) problems.push(`${where}please type the colour.`);
      else if (names.has(c.name.trim().toLowerCase())) problems.push(`The colour ${c.name.trim()} is listed twice.`);
      names.add(c.name.trim().toLowerCase());
      const sizes = new Set<string>();
      c.variants.forEach((v, index) => {
        const label = `${where}${v.size ? `Size ${v.size}` : `Row ${index + 1}`}`;
        if (!v.price || Number(v.price) < 1) problems.push(`${label}: please enter a price.`);
        if (v.compareAt && Number(v.compareAt) <= Number(v.price)) problems.push(`${label}: the old price must be higher than the selling price (or leave it empty).`);
        if (!v.sku.trim()) problems.push(`${label}: the product code is missing.`);
        const key = v.size.trim().toLowerCase();
        if (sizes.has(key)) problems.push(`${label} is listed twice.`);
        sizes.add(key);
      });
    });
    const codes = resolved.flatMap((c) => c.variants.map((v) => v.sku.trim().toLowerCase()));
    if (new Set(codes).size !== codes.length) problems.push("Two sizes have the same product code. Every size needs its own code.");
    if (form.status === "published" && !colors.some((c) => c.photos.length)) problems.push("Add at least one photo before showing this product on the website (or choose “Hidden”).");
    return problems;
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const problems = validate();
    setErrors(problems);
    if (problems.length) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    await saver.run(async () => {
      const fail = (message: string) => {
        setErrors([message]);
        setProgress("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      // 1. the product
      setProgress("Saving the product…");
      const payload = {
        name: form.name.trim(),
        categoryId: form.categoryId,
        typeLabel: form.typeLabel.trim(),
        primaryColour: colors[0].name.trim(),
        material: form.material.trim() || null,
        shortDescription: form.shortDescription.trim() || null,
        description: form.description.trim() || null,
        careInstructions: form.careInstructions.trim() || null,
        status: form.status,
        featured: form.featured,
        badge: form.badge || null,
        seoKeywords: seo.keywords.trim() || null,
        // The Google text is only sent when the owner wrote it (or cleared it to hand it back to the helper); otherwise it is drafted automatically.
        ...(seo.edited ? { seoTitle: seo.title.trim() || null, seoDescription: seo.description.trim() || null, seoLocked: Boolean(seo.title.trim() || seo.description.trim()) } : {}),
      };
      const saved = await callApi<{ product: { id: string } }>(isNew ? "/api/admin/products" : `/api/admin/products/${product!.id}`, isNew ? "POST" : "PATCH", isNew ? { ...payload, material: payload.material ?? undefined, shortDescription: payload.shortDescription ?? undefined, description: payload.description ?? undefined, careInstructions: payload.careInstructions ?? undefined, badge: payload.badge ?? undefined, seoKeywords: payload.seoKeywords ?? undefined, seoTitle: payload.seoTitle ?? undefined, seoDescription: payload.seoDescription ?? undefined } : payload);
      if (!saved.ok) return fail(saved.error);
      const productId = saved.data.product.id;

      // 2. every colour's sizes, prices and stock. The first saved size of a colour is what its photos are linked to.
      const anchors = new Map<string, string>();
      let first = true;
      for (const c of resolved) {
        const colorName = c.name.trim();
        for (const v of c.variants) {
          setProgress(`Saving ${[colorName, v.size ? `size ${v.size}` : "price and stock"].filter(Boolean).join(" · ")}…`);
          const body = {
            name: `${colorName}${v.size ? ` / ${v.size}` : ""}`,
            sku: v.sku.trim(),
            color: colorName,
            size: v.size.trim(),
            price: Number(v.price),
            stockQuantity: Number(v.stock || 0),
            lowStockThreshold: Number(v.low || 3),
          };
          const label = `${multi ? `${colorName} ` : ""}${v.size ? `size ${v.size}` : "price and stock"}`;
          if (v.id) {
            const result = await callApi(`/api/admin/variants/${v.id}`, "PATCH", { ...body, compareAtPrice: v.compareAt ? Number(v.compareAt) : null });
            if (!result.ok) return fail(`${label}: ${result.error}`);
            if (!anchors.has(c.key)) anchors.set(c.key, v.id);
          } else {
            const result = await callApi<{ variant: { id: string } }>("/api/admin/variants", "POST", { ...body, productId, compareAtPrice: v.compareAt ? Number(v.compareAt) : undefined, isDefault: first });
            if (!result.ok) return fail(`${label}: ${result.error}`);
            if (!anchors.has(c.key)) anchors.set(c.key, result.data.variant.id);
          }
          first = false;
        }
      }
      for (const id of removedVariants) await callApi(`/api/admin/variants/${id}`, "DELETE");

      // 3. photos, colour by colour. Only one photo is the product's main one (the first of the first colour that has photos).
      for (const id of removedPhotos) await callApi(`/api/admin/images/${id}`, "DELETE");
      const mainColor = resolved.find((c) => c.photos.length)?.key;
      const newCount = resolved.reduce((sum, c) => sum + c.photos.filter((p) => p.file).length, 0);
      let uploaded = 0;
      for (const c of resolved) {
        const anchor = multi ? anchors.get(c.key) : undefined;
        const ownVariants = new Set(c.variants.flatMap((v) => (v.id ? [v.id] : [])));
        for (let index = 0; index < c.photos.length; index++) {
          const photo = c.photos[index];
          const isMain = c.key === mainColor && index === 0;
          if (photo.file) {
            uploaded += 1;
            setProgress(`Uploading photo ${uploaded} of ${newCount}…`);
            const outcome = await uploadProductPicture({ productId, file: photo.file, altText: `${form.name.trim()}${multi ? ` — ${c.name.trim()}` : ""}${index ? ` — photo ${index + 1}` : ""}`, isPrimary: isMain, sortOrder: index, variantId: anchor });
            if (!outcome.ok) return fail(`The product was saved, but a photo failed: ${outcome.error}`);
          } else if (photo.id) {
            const linked = photo.variantId ? ownVariants.has(photo.variantId) : false;
            await callApi(`/api/admin/images/${photo.id}`, "PATCH", { sortOrder: index, ...(isMain ? { isPrimary: true } : {}), ...(anchor && !linked ? { variantId: anchor } : {}) });
          }
        }
      }

      setDirty(false);
      setProgress("");
      toast(isNew ? "Product added." : "Saved.", "good");
      if (isNew) router.replace(`/admin/products/${productId}`);
      else router.refresh();
    });
  }

  async function removeProduct(permanent: boolean) {
    if (!product) return;
    const result = await callApi(`/api/admin/products/${product.id}${permanent ? "?permanent=true" : ""}`, "DELETE");
    if (result.ok) {
      toast(permanent ? "Product deleted." : "Product is now hidden from your website.", "good");
      setDirty(false);
      router.push("/admin/products");
      router.refresh();
    } else toast(result.error, "bad");
  }

  const previewData: PreviewData = {
    name: form.name.trim(),
    type: form.typeLabel.trim(),
    shortDescription: form.shortDescription.trim(),
    description: form.description.trim(),
    care: form.careInstructions.trim(),
    material: form.material.trim(),
    badge: form.badge,
    colors: resolved.map((c) => ({
      name: c.name.trim(),
      photos: c.photos.map((p) => p.url),
      sizes: c.variants.map((v) => ({ size: v.size.trim(), price: Number(v.price) || 0, compareAt: v.compareAt ? Number(v.compareAt) : null, stock: Math.max(0, Number(v.stock || 0) - v.reserved) })),
    })),
  };
  const busy = saver.pending;
  const saleLooksWrong = resolved.some((c) => c.variants.some((v) => v.compareAt && Number(v.compareAt) <= Number(v.price)));

  return (
    <form onSubmit={save} className="a-stack">
      {errors.length > 0 && (
        <div className="a-note bad" role="alert">
          <Icon name="alert" />
          <div>
            <strong>Please fix this first:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section className="a-card">
        <header className="a-card-head">
          <h2>1. About the product</h2>
        </header>
        <div className="a-card-pad a-form-grid">
          <div className="a-field wide">
            <label htmlFor="pe-name">Product name</label>
            <input id="pe-name" value={form.name} onChange={setField("name")} placeholder="e.g. Olive Cargo Pants" maxLength={120} autoFocus={isNew} />
          </div>
          <div className="a-field">
            <label htmlFor="pe-cat">
              Category <Hint text="Where customers find it on your website, e.g. Shirts or Shalwar Kameez. You can add categories under “Categories”." />
            </label>
            <select id="pe-cat" value={form.categoryId} onChange={setField("categoryId")}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="a-field">
            <label htmlFor="pe-type">
              What is it? <Hint text="Pick from the list or type your own. It helps customers searching on Google." />
            </label>
            <input id="pe-type" value={form.typeLabel} onChange={setField("typeLabel")} list="pe-types" placeholder="e.g. Pants" />
            <datalist id="pe-types">
              {TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="a-field">
            <label htmlFor="pe-fabric">Fabric (optional)</label>
            <input id="pe-fabric" value={form.material} onChange={setField("material")} placeholder="e.g. Cotton twill" />
          </div>
          <div className="a-field wide">
            <div className="a-row" style={{ justifyContent: "space-between" }}>
              <label htmlFor="pe-desc">
                Description <Hint text="What customers read on the product page. Press “Write it for me” to get a first draft, then change anything you like." />
              </label>
              <span className="a-row">
                <button type="button" className="a-btn a-btn-sm" disabled={writer.pending} onClick={() => writeText("write")} title="Writes a short description from the name, colour and fabric">
                  {writer.pending ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkle" size={15} />} Write it for me
                </button>
                <button type="button" className="a-btn a-btn-sm" disabled={writer.pending || !form.description.trim()} onClick={() => writeText("rewrite")} title="Rewrites what you typed so it is easier to find on Google">
                  Improve for Google
                </button>
              </span>
            </div>
            <textarea id="pe-desc" value={form.description} onChange={setField("description")} rows={5} placeholder="Tell customers about the fit, the fabric and when to wear it." maxLength={2000} />
          </div>
          <div className="a-field wide">
            <label htmlFor="pe-short">One short line (optional)</label>
            <input id="pe-short" value={form.shortDescription} onChange={setField("shortDescription")} placeholder="Shown under the product name in lists" maxLength={200} />
          </div>
          <div className="a-field wide">
            <label htmlFor="pe-care">How to wash it (optional)</label>
            <input id="pe-care" value={form.careInstructions} onChange={setField("careInstructions")} placeholder="e.g. Machine wash cold. Do not bleach. Iron on medium heat." maxLength={500} />
          </div>
        </div>
      </section>

      <section className="a-card" aria-label="Colours">
        <header className="a-card-head">
          <h2>2. Colour{multi ? "s" : ""}</h2>
          <Hint text="Selling the same item in more than one colour? Add each colour here. Customers see colour buttons on one product page, and you keep one list in Stock." below />
        </header>
        <div className="a-card-pad a-stack" style={{ gap: 14 }}>
          <div className="a-colortabs" role="group" aria-label="Colours of this product">
            {colors.map((c, index) => (
              <button key={c.key} type="button" aria-pressed={c === current} onClick={() => setActive(index)}>
                {c.name.trim() || "New colour"}
                <small>{c.photos.length} photo{c.photos.length === 1 ? "" : "s"}</small>
              </button>
            ))}
            <button type="button" className="add" onClick={() => setAdding({ name: "", from: current.key })} title="Same product in another colour. Sizes and prices are copied so you only change what is different.">
              <Icon name="plus" size={15} /> Add another colour
            </button>
          </div>
          {adding && (
            <div className="a-note" role="group" aria-label="Add another colour">
              <div className="a-stack" style={{ gap: 10, width: "100%" }}>
                <strong>Add this product in another colour</strong>
                <div className="a-form-grid">
                  <div className="a-field">
                    <label htmlFor="pe-newcolor">New colour</label>
                    <input id="pe-newcolor" value={adding.name} onChange={(event) => setAdding({ ...adding, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addColor(); } }} placeholder="e.g. Navy" maxLength={40} autoFocus />
                  </div>
                  {colors.length > 1 && (
                    <div className="a-field">
                      <label htmlFor="pe-copyfrom">Copy sizes and prices from</label>
                      <select id="pe-copyfrom" value={adding.from} onChange={(event) => setAdding({ ...adding, from: event.target.value })}>
                        {colors.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name.trim() || "New colour"}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <span className="a-help">We copy the sizes, prices and low-stock alerts so you do not type them again. You can change anything afterwards. Stock starts at 0 for the new colour.</span>
                <div className="a-row">
                  <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={addColor}>
                    Add colour
                  </button>
                  <button type="button" className="a-btn a-btn-sm" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="a-row" style={{ alignItems: "flex-end" }}>
            <div className="a-field" style={{ minWidth: 260 }}>
              <label htmlFor="pe-colour">Colour</label>
              <input id="pe-colour" value={current.name} onChange={(event) => renameColor(event.target.value)} placeholder="e.g. Olive" maxLength={40} />
            </div>
            {multi && (
              <button type="button" className="a-btn a-btn-quiet" onClick={() => setRemovingColor(true)}>
                <Icon name="trash" size={16} /> Remove this colour
              </button>
            )}
          </div>
          {multi && <p className="a-help">The photos and sizes below belong to <strong>{current.name.trim() || "this colour"}</strong>. Pick another colour above to change its photos, sizes and stock.</p>}
        </div>
      </section>

      <section className="a-card">
        <header className="a-card-head">
          <h2>3. Photos{multi ? ` · ${current.name.trim() || "this colour"}` : ""}</h2>
          <small>{photos.length} of 12 · the first photo is the main one</small>
        </header>
        <div className="a-card-pad a-stack" style={{ gap: 14 }}>
          <div
            className={`a-drop${over ? " is-over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && fileInput.current?.click()}
            aria-label="Add photos"
          >
            <Icon name="camera" />
            <strong>Drag photos here, or click to choose</strong>
            <span>You can pick many at once. JPG, PNG, WebP, AVIF or GIF. We make five small, fast WebP sizes for you automatically.</span>
          </div>
          <input ref={fileInput} type="file" accept={ACCEPTED_PICTURES} multiple hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          {photos.length > 0 && (
            <div className="a-photos">
              {photos.map((photo, index) => (
                <div key={photo.key} className="a-photo">
                  <div className="img">
                    {photo.file ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.url} alt={`Photo ${index + 1}`} />
                    ) : (
                      <Image src={photo.url} alt={`Photo ${index + 1}`} fill sizes="160px" />
                    )}
                    {index === 0 && <span className="main-tag">Main photo</span>}
                  </div>
                  <div className="tools">
                    <button type="button" onClick={() => movePhoto(photo.key, -1)} disabled={index === 0} aria-label="Move earlier" title="Move earlier">←</button>
                    <button type="button" onClick={() => movePhoto(photo.key, 1)} disabled={index === photos.length - 1} aria-label="Move later" title="Move later">→</button>
                    {index !== 0 && <button type="button" onClick={() => makeMain(photo.key)}>Make main</button>}
                    <button type="button" className="del" onClick={() => removePhoto(photo)} aria-label="Remove photo" title="Remove this photo">
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="a-card">
        <header className="a-card-head">
          <h2>4. Sizes, prices and stock{multi ? ` · ${current.name.trim() || "this colour"}` : ""}</h2>
          <Hint text="One row for each size. Stock is how many you have on the shelf right now. When stock reaches 0 the size shows “Sold out”." below />
        </header>
        <div className="a-card-pad a-stack" style={{ gap: 14 }}>
          <div className="a-row">
            <span className="a-muted">Quick add:</span>
            <button type="button" className="a-btn a-btn-sm" onClick={() => addSizes(TEXT_SIZES)}>
              S M L XL XXL
            </button>
            <button type="button" className="a-btn a-btn-sm" onClick={() => addSizes(WAIST_SIZES)}>
              Waist 28–38
            </button>
            <button type="button" className="a-btn a-btn-sm" onClick={() => addSizes(["One size"])}>
              One size only
            </button>
            <button type="button" className="a-btn a-btn-sm" onClick={() => addSizes([""])} title="Add one more row">
              <Icon name="plus" size={15} /> Another row
            </button>
          </div>
          <div className="a-table-wrap">
            <table className="a-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Size</th>
                  <th>
                    Price (PKR) <Hint text="What the customer pays." below />
                  </th>
                  <th>
                    Old price <Hint text="Optional. If you fill this in, customers see the old price crossed out next to the price — a simple way to show a discount." below />
                  </th>
                  <th>In stock</th>
                  <th>
                    Warn me at <Hint text="You get an alert when the stock falls to this number or lower." below />
                  </th>
                  <th>
                    Product code <Hint text="A short code that is different for every size. We make one for you — you can change it. It is printed on your packing slip." below />
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {withSkus.map((v) => (
                  <tr key={v.key}>
                    <td style={{ width: 110 }}>
                      <input aria-label="Size" value={v.size} onChange={(event) => updateVariant(v.key, { size: event.target.value })} placeholder="M" maxLength={20} />
                    </td>
                    <td style={{ width: 130 }}>
                      <input aria-label="Price" value={v.price} onChange={(event) => updateVariant(v.key, { price: event.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="5500" />
                    </td>
                    <td style={{ width: 130 }}>
                      <input aria-label="Old price" value={v.compareAt} onChange={(event) => updateVariant(v.key, { compareAt: event.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="optional" />
                    </td>
                    <td style={{ width: 110 }}>
                      <input aria-label="In stock" value={v.stock} onChange={(event) => updateVariant(v.key, { stock: event.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                      {v.reserved > 0 && <small className="a-help">{v.reserved} held for orders</small>}
                    </td>
                    <td style={{ width: 100 }}>
                      <input aria-label="Warn me at" value={v.low} onChange={(event) => updateVariant(v.key, { low: event.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                    </td>
                    <td>
                      <input aria-label="Product code" value={v.sku} onChange={(event) => updateVariant(v.key, { sku: event.target.value.toUpperCase().replace(/\s/g, ""), skuTouched: true })} maxLength={40} />
                    </td>
                    <td style={{ width: 52 }}>
                      <button type="button" className="a-icon-btn" aria-label={`Remove size ${v.size || "row"}`} onClick={() => removeVariant(v)} title="Remove this size">
                        <Icon name="trash" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {withSkus.length > 1 && (
            <div className="a-row">
              <button type="button" className="a-btn a-btn-sm" onClick={() => { const first = variants.find((v) => v.price); if (first) { mapCurrent((c) => ({ ...c, variants: c.variants.map((v) => ({ ...v, price: first.price, compareAt: first.compareAt })) })); touch(); } }} disabled={!variants.some((v) => v.price)}>
                Use the first price for every size
              </button>
            </div>
          )}
          {saleLooksWrong && <p className="a-error">The old price must be higher than the price, otherwise it will not look like a discount.</p>}
          {withSkus[0]?.price && <p className="a-help">Customers will see {pkr(Number(withSkus[0].price))}{withSkus[0].compareAt ? ` (was ${pkr(Number(withSkus[0].compareAt))})` : ""}.</p>}
        </div>
      </section>

      <section className="a-card">
        <header className="a-card-head">
          <h2>5. Show it on your website?</h2>
        </header>
        <div className="a-card-pad a-form-grid">
          <fieldset style={{ border: 0, margin: 0, padding: 0, gridColumn: "1 / -1", display: "grid", gap: 10 }}>
            <legend className="sr-only">Visibility</legend>
            <label className="a-check">
              <input type="radio" name="pe-status" checked={form.status === "published"} onChange={() => { setForm((c) => ({ ...c, status: "published" })); touch(); }} />
              <span>
                <strong>Yes — show it to customers</strong>
                <small className="a-help" style={{ display: "block" }}>Customers can see it and buy it right away.</small>
              </span>
            </label>
            <label className="a-check">
              <input type="radio" name="pe-status" checked={form.status === "draft"} onChange={() => { setForm((c) => ({ ...c, status: "draft" })); touch(); }} />
              <span>
                <strong>Hidden for now</strong>
                <small className="a-help" style={{ display: "block" }}>Only you can see it. Good while you are still getting it ready.</small>
              </span>
            </label>
            {form.status === "archived" && <p className="a-note warn">This product is archived (hidden). Choose one of the options above to bring it back.</p>}
          </fieldset>
          <label className="a-check">
            <input type="checkbox" checked={form.featured} onChange={(event) => { setForm((c) => ({ ...c, featured: event.target.checked })); touch(); }} />
            <span>
              <strong>Show on the home page</strong>
              <small className="a-help" style={{ display: "block" }}>Puts it in the “New arrivals” row.</small>
            </span>
          </label>
          <div className="a-field">
            <label htmlFor="pe-badge">
              Small label on the photo <Hint text="A little tag in the corner of the product photo, like “New” or “Bestseller”." />
            </label>
            <select id="pe-badge" value={form.badge} onChange={setField("badge")}>
              {BADGES.map((badge) => (
                <option key={badge} value={badge}>
                  {badge || "None"}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <SeoPanel
        input={{
          name: form.name,
          type: form.typeLabel,
          category: categories.find((c) => c.id === form.categoryId)?.name,
          colors: colors.map((c) => c.name),
          material: form.material,
          shortDescription: form.shortDescription,
          description: form.description,
          photoCounts: colors.map((c) => c.photos.length),
          hasPrice: colors.some((c) => c.variants.some((v) => Number(v.price) > 0)),
        }}
        seo={seo}
        onChange={(patch) => {
          setSeo((current) => ({ ...current, ...patch }));
          touch();
        }}
        onWrite={writeSeo}
        writing={writingSeo}
      />

      <div className="a-savebar">
        <div>
          {busy ? (
            <span className="busy-label">
              <span className="spinner" aria-hidden="true" /> {progress || "Saving…"}
            </span>
          ) : dirty ? (
            <span className="a-muted">You have changes that are not saved yet.</span>
          ) : (
            <span className="a-muted">{isNew ? "Fill in the sections above, then press Save." : "Everything is saved."}</span>
          )}
        </div>
        <div className="a-row">
          <button type="button" className="a-btn" onClick={() => setPreviewing(true)} title="See how this looks to customers on a phone and on a laptop – nothing is saved">
            <Icon name="eye" size={16} /> Preview
          </button>
          {!isNew && (
            <button type="button" className="a-btn a-btn-quiet" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Icon name="trash" size={16} /> Delete…
            </button>
          )}
          <button type="button" className="a-btn" onClick={() => router.push("/admin/products")} disabled={busy}>
            {dirty ? "Leave without saving" : "Back to products"}
          </button>
          <button className="a-btn a-btn-primary a-btn-lg" disabled={busy} aria-busy={busy}>
            {busy ? (
              <span className="busy-label">
                <span className="spinner spinner-light" aria-hidden="true" /> Saving…
              </span>
            ) : isNew ? (
              "Add product"
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </div>

      {previewing && <ProductPreview data={previewData} initialColor={Math.min(active, colors.length - 1)} onClose={() => setPreviewing(false)} />}

      {removingColor && (
        <Dialog title={`Remove the colour “${current.name.trim() || "this colour"}”?` } onClose={() => setRemovingColor(false)}>
          <p>Its sizes, stock and photos are removed when you press <strong>Save</strong>. The other colours are not touched. Old orders keep their record.</p>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={() => setRemovingColor(false)}>
              Go back
            </button>
            <button type="button" className="a-btn a-btn-danger" onClick={removeColor}>
              Remove colour
            </button>
          </div>
        </Dialog>
      )}

      {confirmDelete && product && (
        <Dialog title={`Remove “${product.name}”?`} onClose={() => setConfirmDelete(false)}>
          <p>Choose what you want to do.</p>
          <div className="a-stack" style={{ gap: 10 }}>
            <button type="button" className="a-btn a-btn-lg" onClick={() => removeProduct(false)} style={{ justifyContent: "flex-start", height: "auto", padding: "12px 16px", whiteSpace: "normal", textAlign: "left" }}>
              <span>
                <strong>Hide it from my website</strong>
                <small className="a-muted" style={{ display: "block", fontWeight: 400 }}>Recommended. Nothing is lost and you can bring it back any time.</small>
              </span>
            </button>
            <button type="button" className="a-btn a-btn-danger a-btn-lg" onClick={() => removeProduct(true)} style={{ justifyContent: "flex-start", height: "auto", padding: "12px 16px", whiteSpace: "normal", textAlign: "left" }}>
              <span>
                <strong>Delete it forever</strong>
                <small style={{ display: "block", fontWeight: 400 }}>The product and its photos are erased. Old orders keep their record. This cannot be undone.</small>
              </span>
            </button>
          </div>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={() => setConfirmDelete(false)}>
              Go back
            </button>
          </div>
        </Dialog>
      )}
    </form>
  );
}
