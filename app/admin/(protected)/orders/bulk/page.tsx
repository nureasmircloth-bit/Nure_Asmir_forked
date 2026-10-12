import Link from "next/link";
import { HelpBox } from "../../../_ui/client";
import { PageHeader } from "../../../_ui/ui";
import { BulkOrderPlacer } from "./bulk-order-placer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Place orders in bulk" };

export default function BulkOrdersPage() {
  return (
    <>
      <p style={{ marginBottom: 10 }}>
        <Link href="/admin/orders" className="a-muted">
          ← All orders
        </Link>
      </p>
      <PageHeader
        title="Place orders in bulk with Excel"
        intro="Upload a spreadsheet of customer orders from WhatsApp, exhibition stalls, or corporate clients. Every order is verified against live stock and placed as confirmed."
      />
      <HelpBox id="bulk-orders">
        <ol>
          <li>
            Download the <strong>Excel template</strong> below — it includes your store&apos;s active delivery zones and current sellable product SKUs with available stock counts.
          </li>
          <li>
            Fill in the customer details, delivery zone, and product SKUs. To add multiple items to the same order, use the same <strong>Order #</strong> or keep customer details identical on consecutive rows.
          </li>
          <li>
            Upload your completed file (.xlsx, .csv, or .json) to preview stock availability and pricing before confirming order placement.
          </li>
        </ol>
      </HelpBox>
      <BulkOrderPlacer />
    </>
  );
}
