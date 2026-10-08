"use client";

import { useId, useRef, useState } from "react";
import { useModalFocus } from "@/lib/use-modal-focus";
import type { CatalogProduct } from "@/lib/commerce";
import { Portal } from "../../_components/portal";

// Approximate body measurements in inches. Edit the numbers here to change what every product page shows.
const TOPS = {
  title: "Shirts & shalwar kameez",
  note: "Measure around the fullest part of your chest, over a thin shirt.",
  head: ["Size", "Chest", "Shoulder"],
  rows: [
    ["S", "36–38", "17"],
    ["M", "38–40", "18"],
    ["L", "40–42", "19"],
    ["XL", "42–44", "20"],
    ["XXL", "44–46", "21"],
  ],
};
const PANTS = {
  title: "Pants & trousers",
  note: "Measure around your natural waistline, where you normally wear your pants.",
  head: ["Size", "Waist", "Hip"],
  rows: [
    ["30", "30", "38"],
    ["32", "32", "40"],
    ["34", "34", "42"],
    ["36", "36", "44"],
    ["38", "38", "46"],
  ],
};

const isPants = (product: Pick<CatalogProduct, "type" | "category" | "name">) => /pant|trouser|jean|chino|cargo/i.test(`${product.type} ${product.category} ${product.name}`);

/** "Size guide" link beside the size choice; opens a table of measurements for this kind of product. */
export function SizeGuideLink({ product }: { product: Pick<CatalogProduct, "type" | "category" | "name"> }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const guide = isPants(product) ? PANTS : TOPS;

  useModalFocus(open, dialog, () => setOpen(false)); // focus moves in, stays in, and returns to the link

  return (
    <>
      <button type="button" className="size-guide-link" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Size guide
      </button>
      {open && (
        <Portal>
          <div className="size-guide-scrim" onClick={() => setOpen(false)}>
            <div ref={dialog} className="size-guide" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
              <button type="button" className="size-guide-close" aria-label="Close size guide" onClick={() => setOpen(false)}>
                ×
              </button>
              <h2 id={titleId}>Size guide</h2>
              <p className="size-guide-sub">{guide.title} · inches</p>
              <table>
                <thead>
                  <tr>
                    {guide.head.map((cell) => (
                      <th key={cell}>{cell}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {guide.rows.map((row) => (
                    <tr key={row[0]}>
                      {row.map((cell, index) => (index === 0 ? <th key={cell} scope="row">{cell}</th> : <td key={index}>{cell}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="size-guide-note">{guide.note}</p>
              <p className="size-guide-note">Between two sizes? Choose the larger one for a relaxed fit. Not sure — message us on WhatsApp and we will help you pick.</p>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
