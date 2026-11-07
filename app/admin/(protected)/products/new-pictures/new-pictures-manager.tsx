"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DragEvent, useRef, useState } from "react";
import { ACCEPTED_PICTURES, checkPictureFile, uploadProductPicture } from "@/lib/client-upload";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, Dialog, useToast } from "../../../_ui/client";
import { Icon } from "../../../_ui/icons";
import { Badge, EmptyState, Note } from "../../../_ui/ui";

export type WaitingFile = { id: string; fileName: string; altText: string; isPrimary: boolean; sortOrder: number; variantId: string | null };
export type WaitingProduct = { productId: string; name: string; files: WaitingFile[] };
export type ReadyProduct = { productId: string; name: string; pictures: number; wantsPublished: boolean };

const fileKey = (name: string) => name.trim().toLowerCase();
const stem = (name: string) => fileKey(name).replace(/\.[a-z0-9]+$/, "");

/** How many pictures are shrunk and sent at the same time. */
const AT_ONCE = 3;

/** The drop zone for the pictures of products an assistant added, the list of what each product still needs, and the publish buttons. */
export function NewPicturesManager({ waiting, waitingTotal, ready }: { waiting: WaitingProduct[]; waitingTotal: number; ready: ReadyProduct[] }) {
  const router = useRouter();
  const toast = useToast();
  const uploader = useLockedAction();
  const publisher = useLockedAction();
  const skipper = useLockedAction();
  const input = useRef<HTMLInputElement>(null);
  const [pictures, setPictures] = useState<Map<string, File>>(new Map());
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [skippingAll, setSkippingAll] = useState(false);

  /** The dropped file for a file name from the sheet: the same name, or the same name with another ending (white.jpg and white.png are one picture). */
  const pictureFor = (name: string) => pictures.get(fileKey(name)) ?? [...pictures.entries()].find(([key]) => stem(key) === stem(name))?.[1];
  const wanted = waiting.flatMap((product) => product.files);
  const matched = wanted.filter((file) => pictureFor(file.fileName));
  const missing = wanted.filter((file) => !pictureFor(file.fileName));
  const expectedStems = new Set(wanted.map((file) => stem(file.fileName)));
  const notWanted = [...pictures.values()].filter((file) => !expectedStems.has(stem(file.name)));

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

  /**
   * Saves every matched picture on its product, AT_ONCE at a time (each is shrunk in this browser first, like every picture), with a progress bar. The server crosses each one off the
   * waiting list in the same request that saves it, so a picture can never be saved yet still listed as missing, a failed one simply stays on the list, and if the window is closed
   * halfway the same drop can be repeated: only the pictures still missing are sent.
   */
  async function addMatched() {
    await uploader.run(async () => {
      const jobs = waiting.flatMap((product) => product.files.filter((file) => pictureFor(file.fileName)).sort((a, b) => a.sortOrder - b.sortOrder).map((file) => ({ product, file })));
      let next = 0;
      let finished = 0;
      let done = 0;
      const failed: string[] = [];
      setProgress({ done: 0, total: jobs.length, label: "" });
      const worker = async () => {
        for (;;) {
          const index = next++;
          if (index >= jobs.length) return;
          const { product, file } = jobs[index];
          const outcome = await uploadProductPicture({ productId: product.productId, file: pictureFor(file.fileName) as File, altText: file.altText, isPrimary: file.isPrimary, sortOrder: file.sortOrder, variantId: file.variantId ?? undefined, pendingPictureId: file.id });
          finished += 1;
          if (outcome.ok) done += 1;
          else failed.push(`${product.name} — ${file.fileName}: ${outcome.error}`);
          setProgress({ done: finished, total: jobs.length, label: `${product.name} — ${file.fileName}` });
        }
      };
      await Promise.all(Array.from({ length: Math.min(AT_ONCE, jobs.length) }, worker));
      setProgress({ done: 0, total: 0, label: "" });
      setPictures(new Map());
      if (done) toast(`${done} picture${done === 1 ? "" : "s"} added.`, "good");
      if (failed.length) toast(failed[0] + (failed.length > 1 ? ` (and ${failed.length - 1} more; they stay on the list)` : " (it stays on the list)"), "bad");
      router.refresh();
    });
  }

  /** Stops waiting for some pictures (for example the files do not exist), so the products can be published without them. Each is written to the activity log by the server. */
  async function skipFiles(files: WaitingFile[]) {
    await skipper.run(async () => {
      let removed = 0;
      for (let i = 0; i < files.length; i += 90) {
        const result = await callApi<{ removed: number }>("/api/admin/pending-pictures", "POST", { ids: files.slice(i, i + 90).map((file) => file.id) });
        if (result.ok) removed += result.data.removed;
        else toast(result.error, "bad");
      }
      if (removed) toast(`${removed} picture${removed === 1 ? " is" : "s are"} no longer waited for.`, "good");
      setSkippingAll(false);
      router.refresh();
    });
  }

  async function publish(items: ReadyProduct[]) {
    await publisher.run(async () => {
      let published = 0;
      for (const item of items) {
        const result = await callApi(`/api/admin/products/${item.productId}`, "PATCH", { status: "published" });
        if (result.ok) published += 1;
        else toast(`${item.name}: ${result.error}`, "bad");
      }
      if (published) toast(`${published} product${published === 1 ? " is" : "s are"} now on the website.`, "good");
      router.refresh();
    });
  }

  // “Publish all” leaves out the products the sheet said not to show yet (“Show on website?” = No); each of those still has its own Publish button.
  const publishable = ready.filter((item) => item.pictures > 0 && item.wantsPublished);

  return (
    <div className="a-stack">
      {waiting.length === 0 && ready.length === 0 ? (
        <section className="a-card">
          <EmptyState icon="camera" title="Nothing is waiting">When your AI assistant adds new products, they appear here with the pictures they need.</EmptyState>
        </section>
      ) : null}

      {waiting.length > 0 && (
        <section className="a-card">
          <header className="a-card-head">
            <h2>Waiting for pictures</h2>
            <small>{wanted.length} picture{wanted.length === 1 ? "" : "s"} for {waiting.length} product{waiting.length === 1 ? "" : "s"}</small>
          </header>
          <div className="a-card-pad a-stack" style={{ gap: 14 }}>
            <div
              className={`a-drop${over ? " is-over" : ""}`}
              onDragOver={(event: DragEvent) => { event.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(event: DragEvent) => { event.preventDefault(); setOver(false); addPictures(event.dataTransfer.files); }}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && input.current?.click()}
            >
              <Icon name="camera" />
              <strong>Drag ALL the pictures here at once, or click to choose</strong>
              <span>Select all the files in your folder and drag them in. They are matched to the products by file name. JPG, PNG, WebP, AVIF or GIF.</span>
            </div>
            <input ref={input} type="file" accept={ACCEPTED_PICTURES} multiple hidden onChange={(event) => { if (event.target.files) addPictures(event.target.files); event.target.value = ""; }} />

            {waitingTotal > waiting.length && <Note>Showing the first {waiting.length} of {waitingTotal} products that wait for pictures. Finish these and the next ones appear.</Note>}

            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12, maxHeight: 460, overflowY: "auto" }}>
              {waiting.map((product) => {
                const found = product.files.filter((file) => pictureFor(file.fileName)).length;
                return (
                  <li key={product.productId} className="a-stack" style={{ gap: 6 }}>
                    <div className="a-row">
                      <strong>{product.name}</strong>
                      <Badge tone={found === product.files.length ? "done" : found ? "new" : "muted"}>{found} of {product.files.length} here</Badge>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
                      {product.files.map((file) => {
                        const here = Boolean(pictureFor(file.fileName));
                        return (
                          <li key={file.id} className="a-row" style={{ gap: 8 }}>
                            <span aria-hidden="true">{here ? "✓" : "○"}</span>
                            <code>{file.fileName}</code>
                            <span className="a-muted">{file.altText}{file.isPrimary ? " · main picture" : ""}</span>
                            {!here && <button type="button" className="a-btn a-btn-sm a-btn-quiet" onClick={() => void skipFiles([file])} disabled={skipper.pending} title="Stop waiting for this picture">Skip</button>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {notWanted.length > 0 && <Note tone="warn">{notWanted.length} file{notWanted.length === 1 ? " does" : "s do"} not match any name above and will be ignored: {notWanted.slice(0, 6).map((file) => file.name).join(", ")}{notWanted.length > 6 ? "…" : ""}. File names must be spelled as in the list (capital letters do not matter).</Note>}
          </div>
          <div className="a-card-pad a-stack" style={{ borderTop: "1px solid var(--line)", gap: 10 }}>
            {uploader.pending && progress.total > 0 && (
              <div aria-live="polite">
                <progress value={progress.done} max={progress.total} style={{ width: "100%" }} />
                <span className="a-muted">{progress.done} of {progress.total} added{progress.label ? ` · ${progress.label}` : ""}</span>
              </div>
            )}
            <div className="a-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span className="a-muted" aria-live="polite">{uploader.pending ? "Adding… keep this page open." : matched.length ? `${matched.length} picture${matched.length === 1 ? "" : "s"} ready to add${missing.length ? `, ${missing.length} not here` : ""}` : "Drop the pictures to begin."}</span>
              <div className="a-row" style={{ flexWrap: "wrap" }}>
                {pictures.size > 0 && missing.length > 0 && !uploader.pending && (
                  <button type="button" className="a-btn" onClick={() => setSkippingAll(true)} disabled={skipper.pending} title="Stop waiting for the pictures that are not in your drop">Skip the {missing.length} not here</button>
                )}
                <button type="button" className="a-btn a-btn-primary a-btn-lg" disabled={!matched.length || uploader.pending} aria-busy={uploader.pending} onClick={addMatched}>
                  {uploader.pending ? "Adding…" : `Add ${matched.length} picture${matched.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {skippingAll && (
        <Dialog title={`Stop waiting for ${missing.length} picture${missing.length === 1 ? "" : "s"}?`} onClose={() => setSkippingAll(false)}>
          <p>These pictures are not in what you dropped. The products will no longer wait for them, so you can publish those products without them (you can always add a picture to a product later from its own page).</p>
          <p className="a-muted">Add the pictures you have first (“Add {matched.length} picture{matched.length === 1 ? "" : "s"}”), then skip the rest.</p>
          <div className="a-dialog-actions">
            <button type="button" className="a-btn" onClick={() => setSkippingAll(false)}>Go back</button>
            <button type="button" className="a-btn a-btn-danger" disabled={skipper.pending} aria-busy={skipper.pending} onClick={() => void skipFiles(missing)}>{skipper.pending ? "Working…" : `Skip ${missing.length}`}</button>
          </div>
        </Dialog>
      )}

      {ready.length > 0 && (
        <section className="a-card">
          <header className="a-card-head">
            <h2>Ready to publish</h2>
            <small>Hidden for now: customers cannot see these</small>
          </header>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ready.map((item, index) => (
              <li key={item.productId} className="a-row" style={{ padding: "14px 20px", borderTop: index ? "1px solid var(--line)" : 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{item.name}</strong>{" "}
                  <Badge tone={item.pictures ? "done" : "muted"}>{item.pictures ? `${item.pictures} picture${item.pictures === 1 ? "" : "s"}` : "No picture yet"}</Badge>
                  {!item.wantsPublished && <small className="a-muted" style={{ display: "block" }}>The sheet said “do not show yet”.</small>}
                </div>
                <Link className="a-btn a-btn-sm" href={`/admin/products/${item.productId}`}>Open</Link>
                <button type="button" className="a-btn a-btn-sm a-btn-primary" disabled={!item.pictures || publisher.pending} onClick={() => void publish([item])} title={item.pictures ? "Show on the website" : "Add a picture first"}>Publish</button>
              </li>
            ))}
          </ul>
          {publishable.length > 1 && (
            <div className="a-card-pad a-row" style={{ borderTop: "1px solid var(--line)", justifyContent: "flex-end" }}>
              <button type="button" className="a-btn a-btn-primary" disabled={publisher.pending} aria-busy={publisher.pending} onClick={() => void publish(publishable)} title="Products marked “do not show yet” in the sheet are left out; publish those one by one">Publish all {publishable.length} that are ready</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
