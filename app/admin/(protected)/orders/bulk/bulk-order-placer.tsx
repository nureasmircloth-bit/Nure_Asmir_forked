"use client";

import Link from "next/link";
import { DragEvent, useEffect, useRef, useState } from "react";
import type { PlaceOrderInput } from "@/lib/admin-order-placement";
import { parseOrderTable } from "@/lib/order-sheet";
import { downloadOrderTemplate, readSheetFile } from "@/lib/sheet-client";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, useToast } from "../../../_ui/client";
import { Icon } from "../../../_ui/icons";
import { Badge, pkr } from "../../../_ui/ui";

type Step = "upload" | "preview" | "working" | "done";

type Zone = { id: string; name: string; deliveryCharge: number };
type Variant = { id: string; sku: string; productName: string; variantName: string; price: number; available: number };
type Options = { zones: Zone[]; freeDeliveryThreshold: number; variants: Variant[] };

type PreviewRow =
  | { ok: true; customerName: string; city: string; itemsLabel: string; subtotal: number; deliveryCharge: number; discount: number; total: number }
  | { ok: false; customerName: string; city: string; errors: string[] };

type OrderOutcome = {
  customerName: string;
  ok: boolean;
  orderNumber?: string;
  orderId?: string;
  total?: number;
  message?: string;
};

const hex = (bytes: ArrayBuffer, length: number) => Array.from(new Uint8Array(bytes)).slice(0, length).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256 = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
const ATTEMPT_STORAGE_KEY = "na-bulk-attempt";

/**
 * One key per order: a hash of the order's own content, a counter for identical orders in the same file, and a browser-tab "attempt id".
 * The attempt id is remembered until a placement has put EVERY parsed order in (and no row was left out). Until then, importing a file again
 * (even after correcting a row that was left out, or after a lost answer) gives the orders that did not change the SAME keys, so the server
 * recognises the ones it already placed instead of creating duplicates. Once everything is placed the id is dropped, so importing the same
 * file again later is a new, intended placement with fresh keys.
 */
async function orderKeysFor(orders: PlaceOrderInput[]): Promise<string[]> {
  const bodies = orders.map((order) => JSON.stringify(order));
  let attempt = "";
  try {
    attempt = sessionStorage.getItem(ATTEMPT_STORAGE_KEY) ?? "";
    if (!attempt) {
      attempt = crypto.randomUUID();
      sessionStorage.setItem(ATTEMPT_STORAGE_KEY, attempt);
    }
  } catch {
    attempt = crypto.randomUUID(); // storage blocked: this upload still gets its own stable keys, it just cannot be recognised after a reload
  }
  const seen = new Map<string, number>();
  const keys: string[] = [];
  for (const body of bodies) {
    const n = (seen.get(body) ?? 0) + 1;
    seen.set(body, n);
    keys.push(hex(await sha256(`${attempt}|${n}|${body}`), 16));
  }
  return keys;
}

export function BulkOrderPlacer() {
  const toast = useToast();
  const reading = useLockedAction();
  const placing = useLockedAction();
  const downloading = useLockedAction();

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [parsedOrders, setParsedOrders] = useState<PlaceOrderInput[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [outcomes, setOutcomes] = useState<OrderOutcome[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // One key per order of an upload, made once, so pressing "Place" again after an uncertain answer cannot create a second order.
  const orderKeys = useRef<string[]>([]);
  const [skippedAccepted, setSkippedAccepted] = useState(false);

  useEffect(() => {
    fetch("/api/admin/orders/place/options", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Options | null) => {
        if (data) setOptions(data);
      })
      .catch(() => {});
  }, []);

  async function handleDownloadTemplate() {
    await downloading.run(async () => {
      try {
        let currentOptions = options;
        if (!currentOptions) {
          const res = await fetch("/api/admin/orders/place/options", { cache: "no-store" });
          if (res.ok) currentOptions = await res.json();
        }
        if (!currentOptions) throw new Error("Could not load catalogue reference data.");
        await downloadOrderTemplate({
          zones: currentOptions.zones,
          variants: currentOptions.variants,
        });
        toast("Excel template downloaded.", "good");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not download template.", "bad");
      }
    });
  }

  async function processFile(file: File) {
    await reading.run(async () => {
      setFileName(file.name);
      setParseErrors([]);
      try {
        let orders: PlaceOrderInput[] = [];

        if (/\.json$/i.test(file.name)) {
          const text = await file.text();
          const json = JSON.parse(text);
          orders = Array.isArray(json) ? json : Array.isArray(json.orders) ? json.orders : [];
          if (!orders.length) throw new Error("No orders found in this JSON file.");
        } else {
          const table = await readSheetFile(file);
          const parsed = parseOrderTable(table);
          if (parsed.problems.length > 0 && parsed.orders.length === 0) {
            setParseErrors(parsed.problems);
            return;
          }
          if (parsed.problems.length > 0) {
            setParseErrors(parsed.problems);
          }
          orders = parsed.orders;
        }

        if (!orders.length) {
          toast("No orders found in the uploaded file.", "bad");
          return;
        }

        orderKeys.current = await orderKeysFor(orders);
        setSkippedAccepted(false);
        setParsedOrders(orders);

        // Run live pre-placement dry run check against catalogue and live inventory
        const previewRes = await callApi<{ results: PreviewRow[] }>("/api/admin/orders/place/preview", "POST", { orders });
        if (!previewRes.ok) {
          toast(previewRes.error || "Could not check orders.", "bad");
          return;
        }

        setPreviewRows(previewRes.data.results);
        setStep("preview");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not read this file.", "bad");
      }
    });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  async function runPlaceOrders() {
    await placing.run(async () => {
      setStep("working");
      setOutcomes([]);

      // Filter only orders that passed validation preview
      const validIndices = previewRows
        .map((row, idx) => (row.ok ? idx : -1))
        .filter((idx) => idx !== -1);

      if (validIndices.length === 0) {
        toast("There are no valid orders to place.", "bad");
        setStep("preview");
        return;
      }

      const total = validIndices.length;
      setProgress({ done: 0, total, label: "Starting order placement…" });

      const results: OrderOutcome[] = [];

      for (let i = 0; i < total; i++) {
        const orderIndex = validIndices[i];
        const orderInput = parsedOrders[orderIndex];
        const orderName = orderInput.customerName || `Order #${i + 1}`;

        setProgress({ done: i, total, label: `Placing order ${i + 1} of ${total}: ${orderName}…` });

        const idempotencyKey = orderKeys.current[orderIndex];

        const response = await callApi<{ order: { id: string; orderNumber: string; total: number } }>(
          "/api/admin/orders/place",
          "POST",
          { order: orderInput, idempotencyKey }
        );

        if (response.ok && response.data?.order) {
          results.push({
            customerName: orderName,
            ok: true,
            orderId: response.data.order.id,
            orderNumber: response.data.order.orderNumber,
            total: response.data.order.total,
          });
        } else {
          results.push({
            customerName: orderName,
            ok: false,
            message: !response.ok ? response.error : "Failed to place order.",
          });
        }
      }

      setProgress({ done: total, total, label: "All orders processed!" });
      setOutcomes(results);
      setStep("done");
      // everything placed: forget the attempt, so uploading this file again later is a new placement; otherwise keep it for the retry
      if (results.length === parsedOrders.length && results.every((result) => result.ok) && parseErrors.length === 0) {
        try {
          sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
        } catch {}
      }
      toast(`Processed ${total} orders (${results.filter((r) => r.ok).length} placed successfully).`, "good");
    });
  }

  const validCount = previewRows.filter((r) => r.ok).length;
  const invalidCount = previewRows.filter((r) => !r.ok).length;

  return (
    <div className="a-stack" style={{ gap: 20 }}>
      {/* Step 1: Upload */}
      {step === "upload" && (
        <>
          <div className="a-card a-card-pad" style={{ background: "var(--surface)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
              <div>
                <strong style={{ fontSize: 16 }}>1. Download the Excel template</strong>
                <p className="a-muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
                  The template includes live reference data with your store&apos;s active delivery zones and current sellable product SKUs with available stock.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="a-btn a-btn-primary"
                  onClick={handleDownloadTemplate}
                  disabled={downloading.pending}
                >
                  <Icon name="download" size={16} />
                  {downloading.pending ? "Generating Excel…" : "Download Excel template (.xlsx)"}
                </button>
                <a className="a-btn a-btn-quiet" href="/api/admin/orders/place/template" download="order_place_template.json">
                  JSON template
                </a>
              </div>
            </div>
          </div>

          <div
            className={`a-card a-card-pad ${dragOver ? "drag-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: dragOver ? "2px dashed var(--accent)" : "2px dashed var(--line-strong)",
              background: dragOver ? "var(--surface-2)" : "var(--surface)",
              textAlign: "center",
              padding: "40px 20px",
              cursor: "pointer",
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processFile(file);
              }}
            />
            <div style={{ marginBottom: 12 }}>
              <Icon name="sheet" size={38} />
            </div>
            <strong style={{ fontSize: 16 }}>Drop your completed Excel or CSV file here</strong>
            <p className="a-muted" style={{ margin: "6px 0 16px", fontSize: 13.5 }}>
              or click to browse from your device (.xlsx, .csv, or .json)
            </p>
            <button
              type="button"
              className="a-btn a-btn-sm"
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <Icon name="upload" size={15} /> Select file
            </button>
          </div>

          {reading.pending && (
            <div className="a-card a-card-pad" style={{ textAlign: "center" }}>
              <p className="a-muted" style={{ margin: 0 }}>Reading spreadsheet and checking stock against live catalogue…</p>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="a-card a-card-pad" style={{ borderColor: "var(--red-line)", background: "var(--red-surface)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "var(--red-text)" }}>
                <Icon name="alert" size={18} />
                <strong>Issues found in uploaded sheet</strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5 }}>
                {parseErrors.map((err, i) => (
                  <li key={i}>
                    <strong>Row {err.row}:</strong> {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Step 2: Preview & Validation */}
      {step === "preview" && (
        <>
          <div className="a-card a-card-pad" style={{ background: "var(--surface)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
              <div>
                <strong style={{ fontSize: 17 }}>Reviewing {fileName}</strong>
                <p className="a-muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
                  Every order was checked against active delivery zones, real stock, and sellable variants. Nothing has been saved yet.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  className="a-btn a-btn-quiet"
                  onClick={() => {
                    setParseErrors([]);
                    setStep("upload");
                    setPreviewRows([]);
                    setParsedOrders([]);
                  }}
                >
                  Choose another file
                </button>
                <button
                  type="button"
                  className="a-btn a-btn-primary"
                  onClick={runPlaceOrders}
                  disabled={validCount === 0 || placing.pending || (parseErrors.length > 0 && !skippedAccepted)}
                >
                  <Icon name="check" size={16} /> Place {validCount} valid order{validCount === 1 ? "" : "s"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <Badge tone={validCount > 0 ? "done" : "muted"}>
                {validCount} ready to place
              </Badge>
              {invalidCount > 0 && (
                <Badge tone="bad">
                  {invalidCount} order{invalidCount === 1 ? "" : "s"} with errors (skipped)
                </Badge>
              )}
            </div>
          </div>

          {parseErrors.length > 0 && (
            <div className="a-card a-card-pad" role="alert" style={{ borderColor: "var(--red-line)", background: "var(--red-surface)" }}>
              <strong style={{ color: "var(--red-text)" }}>These spreadsheet rows were left out and will NOT be ordered:</strong>
              <ul style={{ margin: "6px 0 10px", paddingLeft: 20, fontSize: 13.5 }}>
                {parseErrors.map((err, i) => (
                  <li key={i}>
                    <strong>Row {err.row}:</strong> {err.message}
                  </li>
                ))}
              </ul>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                <input type="checkbox" checked={skippedAccepted} onChange={(event) => setSkippedAccepted(event.target.checked)} />
                I understand, place the orders without these rows
              </label>
            </div>
          )}

          <div className="a-card" style={{ overflowX: "auto" }}>
            <table className="a-table" style={{ width: "100%", fontSize: 13.5 }}>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Customer</th>
                  <th>Destination</th>
                  <th>Items</th>
                  <th style={{ textAlign: "right" }}>Subtotal</th>
                  <th style={{ textAlign: "right" }}>Delivery</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => {
                  const input = parsedOrders[idx];
                  if (row.ok) {
                    return (
                      <tr key={idx}>
                        <td className="a-muted">{idx + 1}</td>
                        <td>
                          <strong>{row.customerName}</strong>
                          <div className="a-muted" style={{ fontSize: 12 }}>{input?.customerPhone}</div>
                        </td>
                        <td>
                          {row.city}
                          <div className="a-muted" style={{ fontSize: 12 }}>{input?.zone}</div>
                        </td>
                        <td>{row.itemsLabel}</td>
                        <td style={{ textAlign: "right" }}>{pkr(row.subtotal)}</td>
                        <td style={{ textAlign: "right" }}>{row.deliveryCharge === 0 ? "Free" : pkr(row.deliveryCharge)}</td>
                        <td style={{ textAlign: "right" }}>
                          <strong>{pkr(row.total)}</strong>
                        </td>
                        <td>
                          <Badge tone="done">Ready</Badge>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={idx} style={{ background: "var(--red-surface)" }}>
                      <td className="a-muted">{idx + 1}</td>
                      <td>
                        <strong>{row.customerName || "Unnamed"}</strong>
                        <div className="a-muted" style={{ fontSize: 12 }}>{input?.customerPhone || "No phone"}</div>
                      </td>
                      <td>{row.city || "—"}</td>
                      <td colSpan={4}>
                        <div style={{ color: "var(--red-text)", fontSize: 12.5 }}>
                          {row.errors.map((err, eIdx) => (
                            <div key={eIdx}>• {err}</div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <Badge tone="bad">Error</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Step 3: Working */}
      {step === "working" && (
        <div className="a-card a-card-pad" style={{ textAlign: "center", padding: "48px 20px" }}>
          <div style={{ maxWidth: 420, margin: "0 auto" }}>
            <strong style={{ fontSize: 18, display: "block", marginBottom: 8 }}>Placing orders…</strong>
            <p className="a-muted" style={{ fontSize: 14, marginBottom: 20 }}>{progress.label}</p>
            <div style={{ width: "100%", height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
              <div
                style={{
                  width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                  height: "100%",
                  background: "var(--accent)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <span className="a-muted" style={{ fontSize: 13 }}>
              {progress.done} of {progress.total} completed
            </span>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === "done" && (
        <div className="a-stack" style={{ gap: 16 }}>
          <div className="a-card a-card-pad" style={{ background: "var(--surface)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
              <div>
                <strong style={{ fontSize: 18 }}>Order placement completed!</strong>
                <p className="a-muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
                  Successfully placed {outcomes.filter((r) => r.ok).length} order{outcomes.filter((r) => r.ok).length === 1 ? "" : "s"} on the store. Stock has been reserved and orders are ready in your Orders list.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Link className="a-btn a-btn-primary" href="/admin/orders">
                  View all orders
                </Link>
                <button
                  type="button"
                  className="a-btn a-btn-quiet"
                  onClick={() => {
                    setStep("upload");
                    setPreviewRows([]);
                    setParsedOrders([]);
                    setOutcomes([]);
                  }}
                >
                  Place more orders
                </button>
              </div>
            </div>
          </div>

          <div className="a-card">
            <table className="a-table" style={{ width: "100%", fontSize: 13.5 }}>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((outcome, idx) => (
                  <tr key={idx}>
                    <td>
                      {outcome.orderNumber ? (
                        <Link href={`/admin/orders/${outcome.orderId}`} style={{ fontWeight: 700 }}>
                          #{outcome.orderNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{outcome.customerName}</td>
                    <td>{outcome.total !== undefined ? pkr(outcome.total) : "—"}</td>
                    <td>
                      {outcome.ok ? (
                        <Badge tone="done">Placed (Confirmed)</Badge>
                      ) : (
                        <Badge tone="bad">{outcome.message || "Failed"}</Badge>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {outcome.orderId && (
                        <Link className="a-btn a-btn-sm" href={`/admin/orders/${outcome.orderId}`}>
                          Open order →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
