"use client";

import Link from "next/link";
import { DragEvent, useRef, useState } from "react";
import { ACCEPTED_PICTURES, checkPictureFile, uploadProductPicture } from "@/lib/client-upload";
import { parseProductTable, parseUpdateTable, type ParsedProduct, type SheetProblem, type UpdateRow } from "@/lib/product-sheet";
import { downloadProductTemplate, downloadStockSheet, readSheetFile, type StockExportRow } from "@/lib/sheet-client";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, HelpBox, useToast } from "../../../_ui/client";
import { Icon } from "../../../_ui/icons";
import { Badge, Note, pkr } from "../../../_ui/ui";

type Mode = "add" | "update";
type Step = "start" | "review" | "photos" | "working" | "done";
type Outcome = { name: string; ok: boolean; message: string };

const fileKey = (name: string) => name.trim().toLowerCase();
const stem = (name: string) => fileKey(name).replace(/\.[a-z0-9]+$/, "");

export function BulkUpload({ categoryNames }: { categoryNames: string[] }) {
  const [mode, setMode] = useState<Mode>("add");
  return (
    <div className="a-stack">
      <nav className="a-tabs" aria-label="What do you want to do?">
        <a href="#add" aria-current={mode === "add" ? "page" : undefined} onClick={(event) => { event.preventDefault(); setMode("add"); }}>
          Add new products
        </a>
        <a id="update" href="#update" aria-current={mode === "update" ? "page" : undefined} onClick={(event) => { event.preventDefault(); setMode("update"); }}>
          Change prices &amp; stock
        </a>
      </nav>
      {mode === "add" ? <AddProducts categoryNames={categoryNames} /> : <UpdateStock />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/*  Add new products                                                                            */
/* ------------------------------------------------------------------------------------------- */

function AddProducts({ categoryNames }: { categoryNames: string[] }) {
  const toast = useToast();
  const reading = useLockedAction();
  const importing = useLockedAction();
  const downloading = useLockedAction();
  const [step, setStep] = useState<Step>("start");
  const [products, setProducts] = useState<ParsedProduct[]>([]);
  const [problems, setProblems] = useState<SheetProblem[]>([]);
  const [fileName, setFileName] = useState("");
  const [pictures, setPictures] = useState<Map<string, File>>(new Map());
  const [createCategories, setCreateCategories] = useState(true);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [over, setOver] = useState(false);
  const sheetInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const known = new Set(categoryNames.map((name) => name.toLowerCase()));
  const newCategories = [...new Set(products.map((p) => p.category).filter((name) => !known.has(name.toLowerCase())))];
  const sizesTotal = products.reduce((sum, p) => sum + p.variants.length, 0);

  const pictureFor = (name: string) => pictures.get(fileKey(name)) ?? [...pictures.entries()].find(([key]) => stem(key) === stem(name))?.[1];
  const missingPhotos = products.reduce((n, p) => n + p.photos.filter((file) => !pictureFor(file)).length, 0);
  const withoutAnyPhoto = products.filter((p) => !p.photos.some((file) => pictureFor(file)));

  async function chooseSheet(file: File) {
    await reading.run(async () => {
      try {
        const table = await readSheetFile(file);
        const parsed = parseProductTable(table);
        setProducts(parsed.products);
        setProblems(parsed.problems);
        setFileName(file.name);
        setStep("review");
      } catch (error) {
        toast(error instanceof Error ? error.message : "That file could not be read.", "bad");
      }
    });
  }

  function addPictures(list: FileList | File[]) {
    const next = new Map(pictures);
    const bad: string[] = [];
    for (const file of Array.from(list)) {
      const problem = checkPictureFile(file);
      if (problem) bad.push(problem);
      else next.set(fileKey(file.name), file);
    }
    if (bad.length) toast(bad[0] + (bad.length > 1 ? ` (and ${bad.length - 1} more)` : ""), "bad");
    setPictures(next);
  }

  async function runImport() {
    await importing.run(async () => {
      setStep("working");
      setOutcomes([]);
      const results: Outcome[] = [];
      // Rows with the same product name are ONE product in several colours (the sheet has one row per colour and size).
      type Group = { key: string; first: ParsedProduct; colours: ParsedProduct[] };
      const grouped: Group[] = [];
      for (const entry of products) {
        const key = `${entry.name.toLowerCase()}|${entry.category.toLowerCase()}`;
        const found = grouped.find((group) => group.key === key);
        if (found) found.colours.push(entry);
        else grouped.push({ key, first: entry, colours: [entry] });
      }
      const total = grouped.length;
      setProgress({ done: 0, total, label: "Starting…" });

      if (createCategories && newCategories.length) {
        for (const name of newCategories) {
          setProgress({ done: 0, total, label: `Creating category “${name}”…` });
          const made = await callApi("/api/admin/categories", "POST", { name });
          if (!made.ok && made.status !== 409) results.push({ name: `Category ${name}`, ok: false, message: made.error });
        }
      }

      for (let index = 0; index < grouped.length; index++) {
        const { first: product, colours } = grouped[index];
        setProgress({ done: index, total, label: product.name });
        const photoFilesOf = (entry: ParsedProduct) => entry.photos.filter((file) => pictureFor(file));
        const photoFiles = colours.flatMap(photoFilesOf);
        const sizeCount = colours.reduce((sum, entry) => sum + entry.variants.length, 0);
        const visible = product.visible && photoFiles.length > 0;
        const payload = {
          name: product.name,
          category: product.category,
          typeLabel: product.type,
          subcategory: product.subcategory || undefined,
          visibility: visible ? "published" : "draft",
          badge: product.label || undefined,
          description: product.description || undefined,
          material: product.fabric || undefined,
          primaryColour: product.colour,
          variants: colours.flatMap((colour, colourIndex) => {
            const files = photoFilesOf(colour);
            return colour.variants.map((variant, i) => ({
              name: `${colour.colour}${variant.size ? ` / ${variant.size}` : ""}`,
              color: colour.colour,
              sku: variant.sku,
              size: variant.size || undefined,
              price: variant.price,
              compareAtPrice: variant.oldPrice ?? undefined,
              stockQuantity: variant.stock,
              isDefault: colourIndex === 0 && i === 0,
              images: i === 0 ? files.map((file, order) => ({ file, isPrimary: colourIndex === 0 && order === 0, order, alt: `${product.name}${colours.length > 1 ? ` — ${colour.colour}` : ""}${order ? ` — photo ${order + 1}` : ""}` })) : undefined,
            }));
          }),
        };
        const response = await callApi<{ results: Array<{ success: boolean; productId?: string; error?: string; variantErrors?: string[]; images?: Array<{ file: string; isPrimary: boolean; order: number; alt: string; variantId?: string }> }> }>("/api/admin/products/import?reindex=0", "POST", payload);
        if (!response.ok) {
          results.push({ name: product.name, ok: false, message: response.error });
          continue;
        }
        const result = response.data.results[0];
        if (!result?.success || !result.productId) {
          results.push({ name: product.name, ok: false, message: result?.error ?? "Could not be added." });
          continue;
        }
        const notes: string[] = [];
        if (result.variantErrors?.length) notes.push(result.variantErrors.join(" "));
        let uploaded = 0;
        for (const job of result.images ?? []) {
          const file = pictureFor(job.file);
          if (!file) continue;
          setProgress({ done: index, total, label: `${product.name} — photo ${uploaded + 1}` });
          const outcome = await uploadProductPicture({ productId: result.productId, file, altText: job.alt, isPrimary: job.isPrimary, sortOrder: job.order, variantId: job.variantId });
          if (outcome.ok) uploaded += 1;
          else notes.push(`Photo ${job.file}: ${outcome.error}`);
        }
        const hidden = product.visible && !visible ? "Saved as hidden because it has no photo yet." : "";
        results.push({ name: product.name, ok: true, message: [`${colours.length > 1 ? `${colours.length} colours, ` : ""}${sizeCount} size${sizeCount === 1 ? "" : "s"} added`, uploaded ? `${uploaded} photo${uploaded === 1 ? "" : "s"}` : "", hidden, ...notes].filter(Boolean).join(" · ") });
      }

      setProgress({ done: total, total, label: "Updating website search…" });
      await callApi("/api/admin/search-reindex", "POST");
      setOutcomes(results);
      setStep("done");
    });
  }

  if (step === "working")
    return (
      <section className="a-card a-card-pad a-stack" aria-live="polite">
        <h2>Adding your products…</h2>
        <p className="a-muted">Please keep this page open until it says Done. This can take a few minutes if you have many photos.</p>
        <div className="a-progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
          <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
        <p>
          <span className="spinner" aria-hidden="true" /> {progress.done} of {progress.total} — {progress.label}
        </p>
      </section>
    );

  if (step === "done") {
    const good = outcomes.filter((o) => o.ok).length;
    return (
      <section className="a-card">
        <header className="a-card-head">
          <h2>Done</h2>
          <Badge tone={good === outcomes.length ? "done" : "new"}>{good} added{outcomes.length - good ? `, ${outcomes.length - good} need attention` : ""}</Badge>
        </header>
        <ul style={{ margin: 0, padding: "10px 22px 22px", listStyle: "none", display: "grid", gap: 10 }}>
          {outcomes.map((o, i) => (
            <li key={`${o.name}-${i}`} className="a-row">
              <Badge tone={o.ok ? "done" : "bad"}>{o.ok ? "Added" : "Problem"}</Badge>
              <strong>{o.name}</strong>
              <span className="a-muted">{o.message}</span>
            </li>
          ))}
        </ul>
        <div className="a-card-pad a-row" style={{ borderTop: "1px solid var(--line)" }}>
          <Link className="a-btn a-btn-primary" href="/admin/products">See my products</Link>
          <button type="button" className="a-btn" onClick={() => { setStep("start"); setProducts([]); setPictures(new Map()); setProblems([]); }}>Add another sheet</button>
          {outcomes.some((o) => !o.ok) && <span className="a-muted">Fix the problems in your sheet and upload it again — products that were added will say “already exists”, which is fine.</span>}
        </div>
      </section>
    );
  }

  if (step === "review" || step === "photos")
    return (
      <div className="a-stack">
        <div className="a-wizard" aria-label="Steps">
          <span className="ok">Sheet</span>
          <span className={step === "review" ? "on" : "ok"}>Check</span>
          <span className={step === "photos" ? "on" : ""}>Photos</span>
          <span>Add</span>
        </div>

        {problems.length > 0 && (
          <Note tone="bad">
            <strong>
              {problems.length} problem{problems.length === 1 ? "" : "s"} in “{fileName}”.
            </strong>{" "}
            Rows with a problem will be skipped. Fix them in your sheet and upload again, or continue with the good rows.
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, maxHeight: 180, overflowY: "auto" }}>
              {problems.slice(0, 30).map((problem, i) => (
                <li key={i}>
                  <strong>Row {problem.row}:</strong> {problem.message}
                </li>
              ))}
              {problems.length > 30 && <li>…and {problems.length - 30} more.</li>}
            </ul>
          </Note>
        )}

        {products.length === 0 ? (
          <div className="a-card a-card-pad a-stack">
            <p>No products could be read from this sheet.</p>
            <div>
              <button type="button" className="a-btn" onClick={() => setStep("start")}>Choose another file</button>
            </div>
          </div>
        ) : (
          <>
            {step === "review" && (
              <section className="a-card">
                <header className="a-card-head">
                  <h2>
                    {products.length} product{products.length === 1 ? "" : "s"} · {sizesTotal} size{sizesTotal === 1 ? "" : "s"} ready
                  </h2>
                  <small>From “{fileName}”</small>
                </header>
                <div className="a-table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
                  <table className="a-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Sizes</th>
                        <th className="num">Price</th>
                        <th className="num">Stock</th>
                        <th>On website?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p) => {
                        const prices = p.variants.map((v) => v.price);
                        return (
                          <tr key={p.key}>
                            <td>
                              <strong>{p.name}</strong>
                              <small>
                                {p.type} · {p.colour}
                              </small>
                            </td>
                            <td>
                              {p.category}
                              {!known.has(p.category.toLowerCase()) && <small className="a-muted">new category</small>}
                            </td>
                            <td>{p.variants.map((v) => v.size || "—").join(", ")}</td>
                            <td className="num a-money">{Math.min(...prices) === Math.max(...prices) ? pkr(prices[0]) : `${pkr(Math.min(...prices))} – ${pkr(Math.max(...prices))}`}</td>
                            <td className="num">{p.variants.reduce((s, v) => s + v.stock, 0)}</td>
                            <td>{p.visible ? "Yes" : "Hidden"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {newCategories.length > 0 && (
                  <div className="a-card-pad" style={{ borderTop: "1px solid var(--line)" }}>
                    <label className="a-check">
                      <input type="checkbox" checked={createCategories} onChange={(event) => setCreateCategories(event.target.checked)} />
                      <span>
                        <strong>Create the new categories for me:</strong> {newCategories.join(", ")}
                        <small className="a-help" style={{ display: "block" }}>If you untick this, products in a category that does not exist yet will not be added.</small>
                      </span>
                    </label>
                  </div>
                )}
                <div className="a-card-pad a-row" style={{ borderTop: "1px solid var(--line)", justifyContent: "space-between" }}>
                  <button type="button" className="a-btn" onClick={() => setStep("start")}>
                    ← Choose another file
                  </button>
                  <button type="button" className="a-btn a-btn-primary a-btn-lg" onClick={() => setStep("photos")}>
                    Next: add photos →
                  </button>
                </div>
              </section>
            )}

            {step === "photos" && (
              <section className="a-card">
                <header className="a-card-head">
                  <h2>Add the photos</h2>
                  <small>{pictures.size} picture{pictures.size === 1 ? "" : "s"} chosen</small>
                </header>
                <div className="a-card-pad a-stack" style={{ gap: 14 }}>
                  <p className="a-muted">Choose all the pictures at once — we match them to your products by the file names you wrote in the sheet. You can skip this step and add photos later.</p>
                  <div
                    className={`a-drop${over ? " is-over" : ""}`}
                    onDragOver={(event: DragEvent) => { event.preventDefault(); setOver(true); }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(event: DragEvent) => { event.preventDefault(); setOver(false); addPictures(event.dataTransfer.files); }}
                    onClick={() => photoInput.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && photoInput.current?.click()}
                  >
                    <Icon name="camera" />
                    <strong>Drag all your pictures here, or click to choose</strong>
                    <span>JPG, PNG, WebP, AVIF or GIF</span>
                  </div>
                  <input ref={photoInput} type="file" accept={ACCEPTED_PICTURES} multiple hidden onChange={(event) => { if (event.target.files) addPictures(event.target.files); event.target.value = ""; }} />
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" }}>
                    {products.map((p) => {
                      const found = p.photos.filter((file) => pictureFor(file)).length;
                      return (
                        <li key={p.key} className="a-row">
                          <Badge tone={p.photos.length === 0 ? "muted" : found === p.photos.length ? "done" : "new"}>{p.photos.length === 0 ? "No photo named" : `${found} of ${p.photos.length} found`}</Badge>
                          <strong>{p.name}</strong>
                          {found < p.photos.length && <span className="a-muted">missing: {p.photos.filter((file) => !pictureFor(file)).join(", ")}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {withoutAnyPhoto.some((p) => p.visible) && <Note tone="warn">{withoutAnyPhoto.filter((p) => p.visible).length} product(s) have no photo. They will be added as <strong>Hidden</strong> so customers never see an empty picture — add photos later and switch them on.</Note>}
                  {missingPhotos > 0 && pictures.size > 0 && <p className="a-help">Tip: file names must be spelled exactly as in the sheet (capital letters do not matter).</p>}
                </div>
                <div className="a-card-pad a-row" style={{ borderTop: "1px solid var(--line)", justifyContent: "space-between" }}>
                  <button type="button" className="a-btn" onClick={() => setStep("review")}>
                    ← Back
                  </button>
                  <button type="button" className="a-btn a-btn-primary a-btn-lg" disabled={importing.pending || (newCategories.length > 0 && !createCategories && products.every((p) => !known.has(p.category.toLowerCase())))} onClick={runImport}>
                    Add {products.length} product{products.length === 1 ? "" : "s"} now
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    );

  return (
    <div className="a-stack">
      <HelpBox id="bulk-add">
        <ol>
          <li>
            <strong>Download the sheet</strong> below. It opens in Excel (or Google Sheets).
          </li>
          <li>
            <strong>Fill it in</strong> — one row for each size. There is an example inside to copy.
          </li>
          <li>
            <strong>Upload it here</strong>, choose your photos, and press Add. We check everything first, so nothing goes wrong.
          </li>
        </ol>
      </HelpBox>
      <div className="a-grid a-grid-2">
        <section className="a-card a-card-pad a-stack">
          <h2>1. Get the sheet</h2>
          <p className="a-muted">It already has your categories in a dropdown, and a worked example.</p>
          <div>
            <button type="button" className="a-btn a-btn-primary a-btn-lg" disabled={downloading.pending} onClick={() => downloading.run(async () => { try { await downloadProductTemplate(categoryNames); } catch (error) { toast(error instanceof Error ? error.message : "Could not make the sheet.", "bad"); } })}>
              {downloading.pending ? <span className="spinner spinner-light" aria-hidden="true" /> : <Icon name="download" />} Download the Excel sheet
            </button>
          </div>
          <p className="a-help">Using Google Sheets? In Google Drive choose New → File upload, open the file with Google Sheets, fill it in, then File → Download → Microsoft Excel (.xlsx).</p>
        </section>
        <section className="a-card a-card-pad a-stack">
          <h2>2. Upload your filled sheet</h2>
          <div
            className={`a-drop${over ? " is-over" : ""}`}
            onDragOver={(event: DragEvent) => { event.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(event: DragEvent) => { event.preventDefault(); setOver(false); const file = event.dataTransfer.files[0]; if (file) void chooseSheet(file); }}
            onClick={() => sheetInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && sheetInput.current?.click()}
          >
            {reading.pending ? <span className="spinner" aria-hidden="true" /> : <Icon name="upload" />}
            <strong>{reading.pending ? "Reading your sheet…" : "Drop your Excel file here, or click to choose"}</strong>
            <span>.xlsx (or .csv from Google Sheets)</span>
          </div>
          <input ref={sheetInput} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseSheet(file); event.target.value = ""; }} />
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/*  Change prices & stock                                                                       */
/* ------------------------------------------------------------------------------------------- */

function UpdateStock() {
  const toast = useToast();
  const downloading = useLockedAction();
  const reading = useLockedAction();
  const applying = useLockedAction();
  const [rows, setRows] = useState<UpdateRow[] | null>(null);
  const [problems, setProblems] = useState<SheetProblem[]>([]);
  const [results, setResults] = useState<Array<{ sku: string; ok: boolean; changed: boolean; message: string }> | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function download() {
    await downloading.run(async () => {
      const response = await callApi<{ rows: StockExportRow[] }>("/api/admin/stock/export", "GET");
      if (!response.ok) return void toast(response.error, "bad");
      try {
        await downloadStockSheet(response.data.rows);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Could not make the sheet.", "bad");
      }
    });
  }

  async function choose(file: File) {
    await reading.run(async () => {
      try {
        const parsed = parseUpdateTable(await readSheetFile(file));
        setRows(parsed.rows);
        setProblems(parsed.problems);
        setResults(null);
      } catch (error) {
        toast(error instanceof Error ? error.message : "That file could not be read.", "bad");
      }
    });
  }

  async function apply() {
    if (!rows) return;
    await applying.run(async () => {
      const all: NonNullable<typeof results> = [];
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50).map((r) => ({ sku: r.sku, price: r.price, stock: r.stock, oldPrice: r.oldPrice }));
        const response = await callApi<{ results: NonNullable<typeof results> }>("/api/admin/stock/import", "POST", { rows: chunk });
        if (!response.ok) {
          toast(response.error, "bad");
          break;
        }
        all.push(...response.data.results);
      }
      setResults(all);
      await callApi("/api/admin/search-reindex", "POST");
      toast(`${all.filter((r) => r.changed).length} changed.`, "good");
    });
  }

  return (
    <div className="a-stack">
      <HelpBox id="bulk-update">
        <ol>
          <li>Download your current prices and stock as an Excel sheet.</li>
          <li>Change the <strong>Price</strong>, <strong>Old price</strong> or <strong>In stock</strong> numbers. Do not change the product codes.</li>
          <li>Upload it back here and press Apply. Only the numbers you changed are updated.</li>
        </ol>
      </HelpBox>
      <div className="a-grid a-grid-2">
        <section className="a-card a-card-pad a-stack">
          <h2>1. Download your current numbers</h2>
          <div>
            <button type="button" className="a-btn a-btn-primary a-btn-lg" onClick={download} disabled={downloading.pending}>
              {downloading.pending ? <span className="spinner spinner-light" aria-hidden="true" /> : <Icon name="download" />} Download prices &amp; stock
            </button>
          </div>
        </section>
        <section className="a-card a-card-pad a-stack">
          <h2>2. Upload the changed sheet</h2>
          <div
            className={`a-drop${over ? " is-over" : ""}`}
            onDragOver={(event: DragEvent) => { event.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(event: DragEvent) => { event.preventDefault(); setOver(false); const file = event.dataTransfer.files[0]; if (file) void choose(file); }}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && input.current?.click()}
          >
            {reading.pending ? <span className="spinner" aria-hidden="true" /> : <Icon name="upload" />}
            <strong>Drop your Excel file here, or click to choose</strong>
          </div>
          <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = ""; }} />
        </section>
      </div>

      {problems.length > 0 && (
        <Note tone="bad">
          <strong>Some rows need fixing:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {problems.slice(0, 20).map((p, i) => (
              <li key={i}>Row {p.row}: {p.message}</li>
            ))}
          </ul>
        </Note>
      )}
      {rows && rows.length > 0 && !results && (
        <section className="a-card a-card-pad a-row" style={{ justifyContent: "space-between" }}>
          <span>
            <strong>{rows.length}</strong> row{rows.length === 1 ? "" : "s"} found. Ready to update.
          </span>
          <button type="button" className="a-btn a-btn-primary a-btn-lg" onClick={apply} disabled={applying.pending} aria-busy={applying.pending}>
            {applying.pending ? <span className="busy-label"><span className="spinner spinner-light" aria-hidden="true" /> Updating…</span> : "Apply changes"}
          </button>
        </section>
      )}
      {results && (
        <section className="a-card">
          <header className="a-card-head">
            <h2>Result</h2>
            <Badge tone={results.every((r) => r.ok) ? "done" : "new"}>{results.filter((r) => r.changed).length} changed · {results.filter((r) => r.ok && !r.changed).length} unchanged · {results.filter((r) => !r.ok).length} problems</Badge>
          </header>
          <ul style={{ margin: 0, padding: "10px 22px 20px", listStyle: "none", display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }}>
            {results.filter((r) => !r.ok || r.changed).map((r) => (
              <li key={r.sku} className="a-row">
                <Badge tone={r.ok ? "done" : "bad"}>{r.ok ? "Updated" : "Problem"}</Badge>
                <strong>{r.sku}</strong> <span className="a-muted">{r.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
