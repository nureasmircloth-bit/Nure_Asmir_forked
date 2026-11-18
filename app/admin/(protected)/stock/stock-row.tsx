"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { sizeRank } from "@/lib/catalog-filters";
import { useLockedAction } from "@/lib/use-locked-action";
import { callApi, useToast } from "../../_ui/client";
import { Icon } from "../../_ui/icons";
import { Badge, Thumb } from "../../_ui/ui";

export type StockRowData = { id: string; productId: string; product: string; color: string; size: string | null; sku: string; price: number; stock: number; reserved: number; low: number; matches: boolean };
export type StockGroupData = { id: string; name: string; category: string; status: string; image: string | null; rows: StockRowData[] };


function Availability({ available, low }: { available: number; low: number }) {
  return available <= 0 ? <Badge tone="bad">Sold out</Badge> : available <= low ? <Badge tone="new">{available} left</Badge> : <span>{available}</span>;
}

/** One product in the Stock list: a single line with the totals; press it to see every colour and size. */
export function StockGroup({ group, startOpen, onlyMatches }: { group: StockGroupData; startOpen: boolean; onlyMatches: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const panel = useId();
  const stock = group.rows.reduce((sum, row) => sum + row.stock, 0);
  const held = group.rows.reduce((sum, row) => sum + row.reserved, 0);
  const available = Math.max(0, stock - held);
  const soldOutSizes = group.rows.filter((row) => row.stock - row.reserved <= 0).length;

  const colors = [...new Set(group.rows.map((row) => row.color))];
  const byColor = colors.map((color) => ({
    color,
    rows: group.rows.filter((row) => row.color === color).sort((a, b) => sizeRank(a.size) - sizeRank(b.size)),
  }));
  const multiColor = colors.length > 1;

  return (
    <tbody className={open ? "a-stock-open" : undefined}>
      <tr>
        <td>
          <Link href={`/admin/products/${group.id}`} className="a-prodcell" title="Edit this product">
            <Thumb src={group.image} square />
            <span>
              <strong>{group.name}</strong>
              <small>
                {group.category}
                {group.status !== "published" ? " · hidden from shop" : ""}
              </small>
            </span>
          </Link>
        </td>
        <td className="num">{colors.length}</td>
        <td className="num a-strong">{stock}</td>
        <td className="num">{held || "—"}</td>
        <td>
          {available <= 0 ? <Badge tone="bad">Sold out</Badge> : soldOutSizes > 0 ? <Badge tone="new">{available} · {soldOutSizes} size{soldOutSizes === 1 ? "" : "s"} out</Badge> : <span>{available}</span>}
        </td>
        <td style={{ textAlign: "right", width: 130 }}>
          <button type="button" className="a-btn a-btn-sm" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((value) => !value)} title={open ? "Hide sizes" : "Show colours and sizes"}>
            {open ? "Hide" : "Sizes"} <span aria-hidden="true" style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : undefined }}><Icon name="chevron" size={16} /></span>
          </button>
        </td>
      </tr>
      {open && (
        <tr id={panel} className="a-stock-detail">
          <td colSpan={6}>
            {byColor.map(({ color, rows }) => {
              const colorStock = rows.reduce((sum, row) => sum + row.stock, 0);
              return (
                <section key={color} className="a-stock-color" aria-label={`${color} sizes`}>
                  {(multiColor || color) && (
                    <h3>
                      {color || "No colour"} <small>{colorStock} in stock</small>
                    </h3>
                  )}
                  <table className="a-table a-stock-sizes">
                    <thead>
                      <tr>
                        <th>Size</th>
                        <th>Price (PKR)</th>
                        <th>In stock</th>
                        <th>Held</th>
                        <th>For sale</th>
                        <th>
                          <span className="sr-only">Save</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <SizeRow key={`${row.id}-${row.stock}-${row.price}`} row={row} dim={onlyMatches && !row.matches} />
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </td>
        </tr>
      )}
    </tbody>
  );
}

function SizeRow({ row, dim }: { row: StockRowData; dim: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const action = useLockedAction();
  const [stock, setStock] = useState(String(row.stock));
  const [price, setPrice] = useState(String(row.price));
  const changed = stock !== String(row.stock) || price !== String(row.price);
  const available = Math.max(0, Number(stock || 0) - row.reserved);
  const label = [row.product, row.color, row.size].filter(Boolean).join(" ");

  async function save() {
    await action.run(async () => {
      const result = await callApi(`/api/admin/variants/${row.id}`, "PATCH", { stockQuantity: Number(stock || 0), price: Number(price || 0) });
      if (result.ok) {
        toast(`${label} saved.`, "good");
        router.refresh();
      } else toast(result.error, "bad");
    });
  }

  return (
    <tr className={changed ? "is-selected" : undefined} style={dim ? { opacity: 0.55 } : undefined}>
      <td>
        <strong>{row.size || "One size"}</strong>
        <small className="a-muted" style={{ display: "block" }}>
          {row.sku}
        </small>
      </td>
      <td style={{ width: 130 }}>
        <input aria-label={`Price for ${label}`} value={price} onChange={(event) => setPrice(event.target.value.replace(/\D/g, ""))} inputMode="numeric" />
      </td>
      <td style={{ width: 150 }}>
        <div className="a-row" style={{ gap: 4, flexWrap: "nowrap" }}>
          <button type="button" className="a-btn a-btn-sm" aria-label="One less" onClick={() => setStock(String(Math.max(0, Number(stock || 0) - 1)))}>
            −
          </button>
          <input aria-label={`Stock for ${label}`} value={stock} onChange={(event) => setStock(event.target.value.replace(/\D/g, ""))} inputMode="numeric" style={{ textAlign: "center", minWidth: 60 }} />
          <button type="button" className="a-btn a-btn-sm" aria-label="One more" onClick={() => setStock(String(Number(stock || 0) + 1))}>
            +
          </button>
        </div>
      </td>
      <td>{row.reserved || "—"}</td>
      <td>
        <Availability available={available} low={row.low} />
      </td>
      <td style={{ textAlign: "right", width: 96 }}>
        {changed && (
          <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={save} disabled={action.pending} aria-busy={action.pending}>
            {action.pending ? <span className="spinner spinner-light" aria-hidden="true" /> : null} Save
          </button>
        )}
      </td>
    </tr>
  );
}
