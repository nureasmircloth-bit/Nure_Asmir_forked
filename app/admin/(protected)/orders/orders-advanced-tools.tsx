"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "../../_ui/icons";

export function OrdersAdvancedTools() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`a-btn ${open ? "a-btn-primary" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        title="Show or hide advanced order tools, exports, and workflow guides"
      >
        <Icon name="settings" size={17} />
        <span>{open ? "Hide advanced" : "Advanced"}</span>
      </button>

      {open && (
        <div
          className="a-card a-card-pad"
          style={{
            marginBottom: 16,
            background: "var(--surface-2)",
            borderColor: "var(--line-strong)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <strong style={{ fontSize: 16 }}>Advanced Order Tools &amp; Exports</strong>
              <p className="a-muted" style={{ fontSize: 13.5, margin: "2px 0 0" }}>
                Reports, batch exports, and reference guides kept out of the everyday flow.
              </p>
            </div>
            <button
              type="button"
              className="a-icon-btn"
              onClick={() => setOpen(false)}
              aria-label="Close advanced tools"
            >
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="a-grid a-grid-2" style={{ gap: 16 }}>
            <div style={{ background: "var(--surface)", padding: 14, borderRadius: 10, border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Icon name="sheet" size={18} />
                <strong>Spreadsheet Exports</strong>
              </div>
              <p className="a-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Download orders for bookkeeping, reconciliation, or offline audit.
              </p>
              <div className="a-row" style={{ gap: 8 }}>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  className="a-btn a-btn-sm"
                  href="/api/admin/orders/export?days=30"
                  title="Download the last 30 days of orders (Excel/Sheets)"
                >
                  <Icon name="download" size={15} /> Last 30 days
                </a>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  className="a-btn a-btn-sm"
                  href="/api/admin/orders/export?days=365"
                  title="Download all orders from the past year"
                >
                  <Icon name="download" size={15} /> Past 1 year
                </a>
              </div>
            </div>

            <div style={{ background: "var(--surface)", padding: 14, borderRadius: 10, border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Icon name="info" size={18} />
                <strong>Workflow Reference</strong>
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
                <li>
                  <strong style={{ color: "var(--text)" }}>Needs you:</strong> New orders waiting for phone/WhatsApp confirmation.
                </li>
                <li>
                  <strong style={{ color: "var(--text)" }}>To pack &amp; send:</strong> Confirmed orders ready for TCS booking.
                </li>
                <li>
                  <strong style={{ color: "var(--text)" }}>With TCS:</strong> Collected parcels on their way to customers.
                </li>
              </ol>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <span className="a-muted" style={{ fontSize: 13, alignSelf: "center" }}>Quick links:</span>
            <Link className="a-btn a-btn-sm a-btn-quiet" href="/admin/courier">
              <Icon name="truck" size={15} /> Courier Settings
            </Link>
            <Link className="a-btn a-btn-sm a-btn-quiet" href="/admin/refunds">
              <Icon name="refund" size={15} /> Refund Requests
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
