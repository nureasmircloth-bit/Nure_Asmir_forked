// Reading an order placement sheet (Excel or CSV) into PlaceOrderInput objects.
// Pure functions only — runs in the browser, in tests, or on the server.

import type { PlaceOrderInput } from "./admin-order-placement";

export type OrderSheetColumn = {
  key: string;
  label: string;
  required?: boolean;
  width: number;
  help: string;
  aliases: string[];
};

export const ORDER_SHEET_COLUMNS: OrderSheetColumn[] = [
  { key: "group", label: "Order # (group items)", width: 14, help: "Optional order group number (e.g. 1, 2). Rows with the same number become one multi-item order.", aliases: ["order #", "order id", "order", "group", "group #", "id"] },
  { key: "name", label: "Customer Name*", required: true, width: 24, help: "Full name of the customer.", aliases: ["customer name", "name", "customer", "full name"] },
  { key: "phone", label: "Customer Phone*", required: true, width: 20, help: "Phone number (e.g. 03001234567 or +923001234567).", aliases: ["customer phone", "phone", "mobile", "contact", "phone number", "cell"] },
  { key: "email", label: "Customer Email (optional)", width: 24, help: "Email address for order confirmation receipts.", aliases: ["customer email", "email", "email address"] },
  { key: "city", label: "City*", required: true, width: 18, help: "Destination city, e.g. Lahore, Karachi, Islamabad.", aliases: ["city", "town", "destination"] },
  { key: "province", label: "Province*", required: true, width: 20, help: "Punjab, Sindh, Khyber Pakhtunkhwa, Balochistan, Islamabad Capital Territory, Gilgit-Baltistan, or Azad Jammu and Kashmir.", aliases: ["province", "state", "region"] },
  { key: "address", label: "Address*", required: true, width: 34, help: "Complete street address, house number, area.", aliases: ["address", "street address", "shipping address", "delivery address"] },
  { key: "zone", label: "Delivery Zone*", required: true, width: 20, help: "Active delivery zone name (e.g. Lahore, Nationwide) from the reference sheet.", aliases: ["delivery zone", "zone", "shipping zone"] },
  { key: "paymentMethod", label: "Payment Method*", required: true, width: 18, help: "cod (Cash on Delivery) or bank_deposit.", aliases: ["payment method", "payment", "method", "pay mode"] },
  { key: "paymentStatus", label: "Payment Status (optional)", width: 18, help: "pending or paid (use paid if payment was already received in bank).", aliases: ["payment status", "status", "pay status"] },
  { key: "deliveryCharge", label: "Delivery Charge (PKR)", width: 18, help: "Leave empty for store's automatic calculation, or enter PKR (0 for free).", aliases: ["delivery charge", "shipping fee", "delivery fee", "shipping charge", "delivery"] },
  { key: "discount", label: "Discount (PKR)", width: 16, help: "Whole PKR discount to deduct from total, or leave empty.", aliases: ["discount", "coupon discount", "deduction"] },
  { key: "sku", label: "Product SKU*", required: true, width: 22, help: "SKU code of the product variant (e.g. OK-PNT-32). Check Reference tab.", aliases: ["product sku", "sku", "item sku", "product code", "code"] },
  { key: "quantity", label: "Quantity*", required: true, width: 12, help: "Whole number of items (e.g. 1, 2, 5).", aliases: ["quantity", "qty", "count", "number of items"] },
  { key: "notes", label: "Notes (optional)", width: 26, help: "Special instructions or notes for the order/courier.", aliases: ["notes", "order notes", "remarks", "instructions", "comment"] },
];

const norm = (text: unknown) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[*:_\-./?#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const cleaned = String(value ?? "")
    .replace(/pkr|rs\.?|rupees?|\/-/gi, "")
    .replace(/[,\s]/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export type ParsedOrderSheet = {
  orders: PlaceOrderInput[];
  problems: Array<{ row: number; message: string }>;
  rowCount: number;
};

/**
 * Parses raw rows from an Excel or CSV sheet into structured PlaceOrderInput items.
 * Supports multiple items per order using the order group column or consecutive rows.
 */
export function parseOrderTable(table: unknown[][]): ParsedOrderSheet {
  const problems: Array<{ row: number; message: string }> = [];
  if (!table || table.length === 0) {
    return { orders: [], problems: [{ row: 1, message: "The sheet is empty." }], rowCount: 0 };
  }

  // 1. Locate the header row
  let headerIndex = -1;
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const row = table[i] ?? [];
    const normalizedRow = row.map(norm);
    const hasNameOrPhone = normalizedRow.some((c) => c.includes("name") || c.includes("phone") || c.includes("customer"));
    const hasSkuOrItem = normalizedRow.some((c) => c.includes("sku") || c.includes("code") || c.includes("item"));
    if (hasNameOrPhone && hasSkuOrItem) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    // Default to row 0 if columns match or assume row 0 is header
    headerIndex = 0;
  }

  const headerRow = table[headerIndex] ?? [];
  const colIndexMap: Record<string, number> = {};

  ORDER_SHEET_COLUMNS.forEach((col) => {
    // 1st pass: exact normalized match
    let foundIdx = headerRow.findIndex((cell) => {
      const n = norm(cell);
      return col.aliases.some((alias) => n === norm(alias));
    });
    // 2nd pass: unambiguous substring match if no exact match (min length 4)
    if (foundIdx === -1) {
      foundIdx = headerRow.findIndex((cell) => {
        const n = norm(cell);
        return col.aliases.some((alias) => {
          const na = norm(alias);
          return na.length >= 4 && n.includes(na);
        });
      });
    }
    if (foundIdx !== -1) {
      colIndexMap[col.key] = foundIdx;
    }
  });

  // Verify critical columns
  const missingCritical: string[] = [];
  if (colIndexMap.sku === undefined) missingCritical.push("Product SKU");
  if (colIndexMap.quantity === undefined) missingCritical.push("Quantity");
  if (colIndexMap.name === undefined) missingCritical.push("Customer Name");
  if (colIndexMap.phone === undefined) missingCritical.push("Customer Phone");
  if (colIndexMap.city === undefined) missingCritical.push("City");
  if (colIndexMap.address === undefined) missingCritical.push("Address");

  if (missingCritical.length > 0) {
    return {
      orders: [],
      problems: [
        {
          row: headerIndex + 1,
          message: `Missing required column(s): ${missingCritical.join(", ")}. Please use the provided template.`,
        },
      ],
      rowCount: 0,
    };
  }

  const getCell = (row: unknown[], key: string): string => {
    const idx = colIndexMap[key];
    if (idx === undefined) return "";
    const val = row[idx];
    if (val === undefined || val === null) return "";
    return String(val).trim();
  };

  const getNumber = (row: unknown[], key: string): number | null => {
    const idx = colIndexMap[key];
    if (idx === undefined) return null;
    return parseNumber(row[idx]);
  };

  type DraftOrder = {
    groupKey: string;
    row: number;
    input: PlaceOrderInput;
  };

  const orders: DraftOrder[] = [];
  const ordersByGroup = new Map<string, DraftOrder>();
  let currentOrder: DraftOrder | null = null;
  let autoGroupCounter = 1;

  for (let r = headerIndex + 1; r < table.length; r++) {
    const row = table[r];
    if (!row || row.every((c) => c === undefined || c === null || String(c).trim() === "")) {
      continue; // empty row
    }

    const rowNum = r + 1;
    const groupVal = getCell(row, "group");
    const name = getCell(row, "name");
    const phone = getCell(row, "phone");
    const sku = getCell(row, "sku");
    const qtyVal = getNumber(row, "quantity");

    if (!sku) {
      problems.push({ row: rowNum, message: "Missing Product SKU." });
      continue;
    }

    if (qtyVal === null || qtyVal <= 0 || !Number.isInteger(qtyVal)) {
      problems.push({ row: rowNum, message: "Quantity must be an entered positive whole number (e.g. 1, 2, 3)." });
      continue;
    }
    const quantity = qtyVal;

    // Check if this row belongs to an existing group across all previous rows
    if (groupVal && ordersByGroup.has(groupVal)) {
      const existing = ordersByGroup.get(groupVal)!;
      if (name && existing.input.customerName && norm(name) !== norm(existing.input.customerName)) {
        problems.push({ row: rowNum, message: `Conflicting customer name for Order #${groupVal}: "${name}" does not match existing "${existing.input.customerName}".` });
        continue;
      }
      if (phone && existing.input.customerPhone && norm(phone) !== norm(existing.input.customerPhone)) {
        problems.push({ row: rowNum, message: `Conflicting customer phone for Order #${groupVal}: "${phone}" does not match existing "${existing.input.customerPhone}".` });
        continue;
      }
      existing.input.items.push({ sku, quantity });
      currentOrder = existing;
      continue;
    }

    // Check if this row belongs to current order without group key
    const isContinuationOfCurrent =
      Boolean(currentOrder) &&
      !groupVal &&
      ((!name && !phone) || (name === currentOrder?.input.customerName && phone === currentOrder?.input.customerPhone));

    if (isContinuationOfCurrent && currentOrder) {
      currentOrder.input.items.push({ sku, quantity });
      continue;
    }

    // Starting a new order
    if (!name) problems.push({ row: rowNum, message: "Missing Customer Name." });
    if (!phone) problems.push({ row: rowNum, message: "Missing Customer Phone." });
    const city = getCell(row, "city");
    if (!city) problems.push({ row: rowNum, message: "Missing City." });
    const province = getCell(row, "province") || "Punjab";
    const address = getCell(row, "address");
    if (!address) problems.push({ row: rowNum, message: "Missing Address." });

    const zone = getCell(row, "zone");
    const rawMethod = getCell(row, "paymentMethod").toLowerCase().trim();
    let paymentMethod: "cod" | "bank_deposit" = "cod";
    if (!rawMethod || rawMethod === "cod" || rawMethod.includes("cash on delivery")) {
      paymentMethod = "cod";
    } else if (rawMethod.includes("bank") || rawMethod.includes("deposit") || rawMethod.includes("transfer") || rawMethod === "ibft") {
      paymentMethod = "bank_deposit";
    } else {
      problems.push({ row: rowNum, message: `Unrecognized payment method "${rawMethod}". Use "cod" or "bank_deposit".` });
    }

    const rawStatus = getCell(row, "paymentStatus").toLowerCase().trim();
    let paymentStatus: "pending" | "paid" = "pending";
    if (!rawStatus || rawStatus === "pending" || rawStatus === "unpaid") {
      paymentStatus = "pending";
    } else if (rawStatus === "paid" || rawStatus === "received") {
      paymentStatus = "paid";
    } else {
      problems.push({ row: rowNum, message: `Unrecognized payment status "${rawStatus}". Use "pending" or "paid".` });
    }

    const deliveryCharge = getNumber(row, "deliveryCharge");
    const discount = getNumber(row, "discount");
    const email = getCell(row, "email") || undefined;
    const notes = getCell(row, "notes") || undefined;

    const groupKey = groupVal || `auto_${autoGroupCounter++}`;

    const newOrder: DraftOrder = {
      groupKey,
      row: rowNum,
      input: {
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        city,
        province,
        address,
        zone: zone || undefined,
        paymentMethod,
        paymentStatus,
        deliveryCharge: deliveryCharge !== null && deliveryCharge >= 0 ? deliveryCharge : undefined,
        discount: discount !== null && discount >= 0 ? discount : undefined,
        notes,
        items: [{ sku, quantity }],
      },
    };

    orders.push(newOrder);
    if (groupVal) ordersByGroup.set(groupVal, newOrder);
    currentOrder = newOrder;
  }

  return {
    orders: orders.map((o) => o.input),
    problems,
    rowCount: orders.length,
  };
}
