import Link from "next/link";
import { count, desc, ne, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiProducts, pendingPictures, productImages, products } from "@/db/schema";
import { PageHeader } from "../../../_ui/ui";
import { NewPicturesManager, type ReadyProduct, type WaitingProduct } from "./new-pictures-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pictures for new products" };

/** Products an AI assistant added as hidden drafts: the pictures they wait for (drop them here), and the ones that are ready to publish. */
export default async function NewPicturesPage() {
  const made = await db
    .select({ productId: aiProducts.productId, name: products.name, status: products.status, wantsPublished: aiProducts.wantsPublished })
    .from(aiProducts)
    .innerJoin(products, eq(products.id, aiProducts.productId))
    .where(ne(products.status, "archived"))
    .orderBy(desc(aiProducts.createdAt))
    .limit(200);
  const pending = made.length ? await db.select().from(pendingPictures).orderBy(pendingPictures.sortOrder).limit(1000) : [];
  const counts = made.length ? await db.select({ productId: productImages.productId, n: count() }).from(productImages).groupBy(productImages.productId) : [];
  const pictureCount = new Map(counts.map((row) => [row.productId, row.n]));

  const waiting: WaitingProduct[] = [];
  const ready: ReadyProduct[] = [];
  for (const product of made) {
    const files = pending.filter((row) => row.productId === product.productId).map((row) => ({ id: row.id, fileName: row.fileName, altText: row.altText, isPrimary: row.isPrimary, sortOrder: row.sortOrder, variantId: row.variantId }));
    if (files.length) waiting.push({ productId: product.productId, name: product.name, files });
    else if (product.status === "draft") ready.push({ productId: product.productId, name: product.name, pictures: pictureCount.get(product.productId) ?? 0, wantsPublished: product.wantsPublished });
  }
  return (
    <>
      <p style={{ marginBottom: 10 }}>
        <Link href="/admin/products" className="a-muted">← All products</Link>
      </p>
      <PageHeader title="Pictures for new products" intro="Products your AI assistant added are saved hidden. Drag their pictures here: they are matched by file name and put on the right product and colour. Then publish." />
      <NewPicturesManager waiting={waiting} ready={ready} />
    </>
  );
}
