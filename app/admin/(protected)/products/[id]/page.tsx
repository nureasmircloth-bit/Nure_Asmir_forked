import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, productImages, products, productVariants } from "@/db/schema";
import { PageHeader } from "../../../_ui/ui";
import { ProductEditor } from "../product-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) notFound();

  const [cats, variants, images] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt)),
    db.select().from(productImages).where(eq(productImages.productId, id)).orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.createdAt)),
  ]);

  return (
    <>
      <p style={{ marginBottom: 10 }}>
        <Link href="/admin/products" className="a-muted">
          ← All products
        </Link>
      </p>
      <PageHeader title={product.name} intro={product.status === "published" ? "This product is on your website." : product.status === "draft" ? "This product is hidden from customers." : "This product has been removed from your website."} />
      <ProductEditor
        key={`${product.id}-${product.updatedAt.getTime()}`}
        categories={cats}
        product={{
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          typeLabel: product.typeLabel,
          primaryColour: product.primaryColour ?? variants[0]?.color ?? "",
          material: product.material ?? "",
          shortDescription: product.shortDescription ?? "",
          description: product.description ?? "",
          careInstructions: product.careInstructions ?? "",
          status: product.status as "draft" | "published" | "archived",
          featured: product.featured,
          badge: product.badge ?? "",
          seoTitle: product.seoTitle,
          seoKeywords: product.seoKeywords,
          seoLocked: product.seoLocked,
          seoDescription: product.seoDescription,
        }}
        variants={variants.filter((v) => v.status === "active").map((v) => ({ id: v.id, color: v.color, size: v.size ?? "", sku: v.sku, price: v.price, compareAtPrice: v.compareAtPrice, stockQuantity: v.stockQuantity, reservedQuantity: v.reservedQuantity, lowStockThreshold: v.lowStockThreshold }))}
        images={images.filter((i) => i.status === "active").map((i) => ({ id: i.id, variantId: i.variantId, r2Key: i.r2Key, variantWidths: i.variantWidths, isPrimary: i.isPrimary, sortOrder: i.sortOrder, altText: i.altText }))}
      />
    </>
  );
}
