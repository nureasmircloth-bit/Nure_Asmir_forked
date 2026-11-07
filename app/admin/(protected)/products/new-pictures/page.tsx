import Link from "next/link";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { chunked } from "@/db/sql-compat";
import { aiProducts, pendingPictures, productImages, productVariants, products } from "@/db/schema";
import { PageHeader, Pager } from "../../../_ui/ui";
import { NewPicturesManager, type ReadyProduct, type WaitingProduct } from "./new-pictures-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pictures for new products" };

/** The most products shown in the waiting list at once (a big drop is matched against all of them). Finish these and the next ones appear. */
const WAITING_CAP = 500;
/** Products on a page of the “ready to publish” list. */
const PAGE_SIZE = 30;

const hasWaitingPictures = sql`exists (select 1 from pending_pictures pp where pp.product_id = ${products.id})`;

/** Products an AI assistant added as hidden drafts: ALL the ones waiting for pictures on one page (so one big drop covers them all), and the ones ready to publish, paged. */
export default async function NewPicturesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);

  // Waiting for pictures: every one, newest first, up to WAITING_CAP.
  const waitingWhere = and(ne(products.status, "archived"), hasWaitingPictures);
  const [{ waitingTotal }] = await db.select({ waitingTotal: count() }).from(aiProducts).innerJoin(products, eq(products.id, aiProducts.productId)).where(waitingWhere);
  const waitingRows = await db
    .select({ productId: aiProducts.productId, name: products.name })
    .from(aiProducts)
    .innerJoin(products, eq(products.id, aiProducts.productId))
    .where(waitingWhere)
    .orderBy(desc(aiProducts.createdAt), products.name)
    .limit(WAITING_CAP);

  // Ready to publish: hidden, nothing left to wait for. Paged.
  const readyWhere = and(eq(products.status, "draft"), sql`not ${hasWaitingPictures}`);
  const [{ readyTotal }] = await db.select({ readyTotal: count() }).from(aiProducts).innerJoin(products, eq(products.id, aiProducts.productId)).where(readyWhere);
  const readyRows = await db
    .select({ productId: aiProducts.productId, name: products.name, wantsPublished: aiProducts.wantsPublished })
    .from(aiProducts)
    .innerJoin(products, eq(products.id, aiProducts.productId))
    .where(readyWhere)
    .orderBy(desc(aiProducts.createdAt), products.name)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Everything about THESE products only (never a global cut-off), in groups small enough for the database.
  const pending: Array<typeof pendingPictures.$inferSelect> = [];
  const sizes: Array<{ id: string; productId: string; color: string; isDefault: boolean }> = [];
  for (const part of chunked(waitingRows.map((row) => row.productId))) {
    pending.push(...(await db.select().from(pendingPictures).where(inArray(pendingPictures.productId, part)).orderBy(pendingPictures.sortOrder, pendingPictures.fileName)));
    sizes.push(...(await db.select({ id: productVariants.id, productId: productVariants.productId, color: productVariants.color, isDefault: productVariants.isDefault }).from(productVariants).where(and(inArray(productVariants.productId, part), eq(productVariants.status, "active"))).orderBy(desc(productVariants.isDefault), productVariants.size)));
  }
  const counts: Array<{ productId: string; n: number }> = [];
  for (const part of chunked(readyRows.map((row) => row.productId))) {
    counts.push(...(await db.select({ productId: productImages.productId, n: count() }).from(productImages).where(inArray(productImages.productId, part)).groupBy(productImages.productId)));
  }
  const pictureCount = new Map(counts.map((row) => [row.productId, row.n]));
  // The size a colour's pictures are attached to is looked up NOW (the colour's first active size), so a size that was removed after the product was made never leaves a picture pointing at nothing.
  const sizeOfColour = (productId: string, colour: string | null) => (colour ? (sizes.find((size) => size.productId === productId && size.color === colour)?.id ?? null) : null);

  const waiting: WaitingProduct[] = waitingRows.map((product) => ({
    productId: product.productId,
    name: product.name,
    files: pending.filter((row) => row.productId === product.productId).map((row) => ({ id: row.id, fileName: row.fileName, altText: row.altText, isPrimary: row.isPrimary, sortOrder: row.sortOrder, variantId: sizeOfColour(product.productId, row.color) })),
  }));
  const ready: ReadyProduct[] = readyRows.map((product) => ({ productId: product.productId, name: product.name, pictures: pictureCount.get(product.productId) ?? 0, wantsPublished: product.wantsPublished }));
  return (
    <>
      <p style={{ marginBottom: 10 }}>
        <Link href="/admin/products" className="a-muted">← All products</Link>
      </p>
      <PageHeader title="Pictures for new products" intro="Products your AI assistant added are saved hidden. Drag ALL their pictures here at once: they are matched by file name and put on the right product and colour. Then publish." />
      <NewPicturesManager waiting={waiting} waitingTotal={waitingTotal} ready={ready} />
      <Pager page={page} pageSize={PAGE_SIZE} total={readyTotal} hrefFor={(next) => `/admin/products/new-pictures${next > 1 ? `?page=${next}` : ""}`} />
    </>
  );
}
