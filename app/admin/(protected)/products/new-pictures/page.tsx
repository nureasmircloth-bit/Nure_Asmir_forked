import Link from "next/link";
import { and, count, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { aiProducts, pendingPictures, productImages, productVariants, products } from "@/db/schema";
import { PageHeader, Pager } from "../../../_ui/ui";
import { NewPicturesManager, type ReadyProduct, type WaitingProduct } from "./new-pictures-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pictures for new products" };

const PAGE_SIZE = 30;

/** Products an AI assistant added as hidden drafts: the pictures they wait for (drop them here), and the ones that are ready to publish. */
export default async function NewPicturesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  // Only the unfinished ones: still waiting for a picture, or hidden and ready to publish. They are picked BEFORE the page is cut, so an old unfinished product is never pushed out of sight by newer finished ones.
  const unfinished = and(
    ne(products.status, "archived"),
    or(eq(products.status, "draft"), sql`exists (select 1 from pending_pictures pp where pp.product_id = ${products.id})`),
  );
  const [{ total }] = await db.select({ total: count() }).from(aiProducts).innerJoin(products, eq(products.id, aiProducts.productId)).where(unfinished);
  const made = await db
    .select({ productId: aiProducts.productId, name: products.name, status: products.status, wantsPublished: aiProducts.wantsPublished })
    .from(aiProducts)
    .innerJoin(products, eq(products.id, aiProducts.productId))
    .where(unfinished)
    .orderBy(desc(aiProducts.createdAt), products.name)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Everything about THESE products only (never a global cut-off), in groups small enough for the database.
  const ids = made.map((product) => product.productId);
  const pending: Array<typeof pendingPictures.$inferSelect> = [];
  const sizes: Array<{ id: string; productId: string; color: string; isDefault: boolean }> = [];
  const counts: Array<{ productId: string; n: number }> = [];
  for (const part of chunked(ids)) {
    pending.push(...(await db.select().from(pendingPictures).where(inArray(pendingPictures.productId, part)).orderBy(pendingPictures.sortOrder, pendingPictures.fileName)));
    sizes.push(...(await db.select({ id: productVariants.id, productId: productVariants.productId, color: productVariants.color, isDefault: productVariants.isDefault }).from(productVariants).where(and(inArray(productVariants.productId, part), eq(productVariants.status, "active"))).orderBy(desc(productVariants.isDefault), productVariants.size)));
    counts.push(...(await db.select({ productId: productImages.productId, n: count() }).from(productImages).where(inArray(productImages.productId, part)).groupBy(productImages.productId)));
  }
  const pictureCount = new Map(counts.map((row) => [row.productId, row.n]));
  // The size a colour's pictures are attached to is looked up NOW (the colour's first active size), so a size that was removed after the product was made never leaves a picture pointing at nothing.
  const sizeOfColour = (productId: string, colour: string | null) => (colour ? (sizes.find((size) => size.productId === productId && size.color === colour)?.id ?? null) : null);

  const waiting: WaitingProduct[] = [];
  const ready: ReadyProduct[] = [];
  for (const product of made) {
    const files = pending.filter((row) => row.productId === product.productId).map((row) => ({ id: row.id, fileName: row.fileName, altText: row.altText, isPrimary: row.isPrimary, sortOrder: row.sortOrder, variantId: sizeOfColour(product.productId, row.color) }));
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
      <Pager page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(next) => `/admin/products/new-pictures${next > 1 ? `?page=${next}` : ""}`} />
    </>
  );
}
