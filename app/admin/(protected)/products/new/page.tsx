import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { Note, PageHeader } from "../../../_ui/ui";
import { ProductEditor } from "../product-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const rows = await db.select({ id: categories.id, name: categories.name, subcategories: categories.subcategories }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  const list = rows.map((row) => ({ id: row.id, name: row.name, subcategories: (row.subcategories ?? "").split(",").map((part) => part.trim()).filter(Boolean) }));
  return (
    <>
      <p style={{ marginBottom: 10 }}>
        <Link href="/admin/products" className="a-muted">
          ← All products
        </Link>
      </p>
      <PageHeader title="Add a product" intro="Fill in the four sections, then press Add product. Nothing is shown to customers until you say so." />
      <ProductEditor categories={list} />
    </>
  );
}
