// Seeds the Nure Asmir storefront: admin owner, store settings, delivery zones, categories, a
// starter catalogue and the homepage banners. Photos come from nure_asmir_assets/web, are
// converted to the standard WebP widths (same naming the admin uploader produces) and uploaded to
// the Neon public bucket. Idempotent — safe to re-run; existing rows are left untouched.
//
// Usage: npm run db:seed
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  adminOwners,
  campaignSlides,
  categories,
  deliveryZones,
  productImages,
  products,
  productVariants,
  siteSettings,
} from "../db/schema";
import { hashPassword } from "../lib/auth/password";
import { slugify } from "../lib/slug";
import { STANDARD_WIDTHS, variantKeyFor } from "../lib/image-variants";
import { putObject } from "../lib/storage";

const ASSET_DIR = path.join(process.cwd(), "nure_asmir_assets", "web");

type StoredImage = {
  key: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  blurDataUrl: string;
  variantWidths: number[];
};

/** Uploads the original plus resized WebP variants (<= source width) and returns what the DB needs. */
async function uploadImage(file: string, key: string, crop?: { left: number; top: number; width: number; height: number }): Promise<StoredImage> {
  let input = sharp(await readFile(path.join(ASSET_DIR, file)));
  if (crop) input = sharp(await input.extract(crop).jpeg({ quality: 90 }).toBuffer());
  const original = await input.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const meta = await sharp(original).metadata();
  const width = meta.width ?? 1000;
  const height = meta.height ?? 1000;
  await putObject(key, original, "image/jpeg");

  const variantWidths: number[] = [];
  for (const target of STANDARD_WIDTHS) {
    const w = Math.min(target, width);
    const webp = await sharp(original).resize({ width: w }).webp({ quality: 78 }).toBuffer();
    await putObject(variantKeyFor(key, w), webp, "image/webp");
    variantWidths.push(w);
    if (target >= width) break;
  }
  const blur = await sharp(original).resize({ width: 20 }).webp({ quality: 20 }).toBuffer();
  return {
    key,
    contentType: "image/jpeg",
    byteSize: original.byteLength,
    width,
    height,
    blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
    variantWidths,
  };
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) {
    console.log("Skipping admin seed — ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD not set in .env.local");
    return;
  }
  const [existing] = await db.select().from(adminOwners).limit(1);
  if (existing) {
    console.log(`Admin owner already exists (${existing.email}) — skipping.`);
    return;
  }
  await db.insert(adminOwners).values({
    email: email.toLowerCase(),
    displayName: "Owner",
    passwordHash: await hashPassword(password),
    role: "owner",
  });
  console.log(`Seeded admin owner: ${email}`);
}

async function seedSiteSettings() {
  const [existing] = await db.select().from(siteSettings).where(eq(siteSettings.id, "store")).limit(1);
  if (existing) return;
  await db.insert(siteSettings).values({
    id: "store",
    brandName: "Nure Asmir",
    whatsappNumber: process.env.WHATSAPP_DEFAULT_NUMBER ?? "",
    freeDeliveryThreshold: 10000,
    codReservationHours: 12,
    bankReservationHours: 24,
    taxEnabled: false,
    currency: "PKR",
  });
  console.log("Seeded site_settings.");
}

async function seedDeliveryZones() {
  const [existing] = await db.select().from(deliveryZones).limit(1);
  if (existing) return;
  await db.insert(deliveryZones).values([
    { name: "Karachi", cities: ["Karachi"], provinces: ["Sindh"], deliveryCharge: 250, estimatedDaysMin: 1, estimatedDaysMax: 3, sortOrder: 0 },
    { name: "Lahore & Islamabad", cities: ["Lahore", "Islamabad", "Rawalpindi"], provinces: ["Punjab"], deliveryCharge: 300, estimatedDaysMin: 2, estimatedDaysMax: 4, sortOrder: 1 },
    { name: "Rest of Pakistan", cities: [], provinces: ["Punjab", "Sindh", "KPK", "Balochistan", "Gilgit-Baltistan", "Azad Kashmir"], deliveryCharge: 400, estimatedDaysMin: 3, estimatedDaysMax: 6, sortOrder: 2 },
  ]);
  console.log("Seeded delivery zones.");
}

type Category = { name: string; slug: string; description: string; cover: string; hero: string; sortOrder: number };

const CATEGORIES: Category[] = [
  { name: "Shalwar Kameez", slug: "shalwar-kameez", description: "Everyday and occasion wear, cut clean.", cover: "kameez-espresso.jpg", hero: "banner-storefront.jpg", sortOrder: 0 },
  { name: "Shirts", slug: "shirts", description: "Camp collars and tees with considered detail.", cover: "camp-collar-shirt.jpg", hero: "banner-storefront.jpg", sortOrder: 1 },
  { name: "Pants", slug: "pants", description: "Relaxed, well-cut trousers.", cover: "pants-cargo.jpg", hero: "banner-storefront.jpg", sortOrder: 2 },
  { name: "Accessories", slug: "accessories", description: "Leather goods for the everyday carry.", cover: "acc-belt.jpg", hero: "banner-coming-soon.jpg", sortOrder: 3 },
];

async function seedCategories() {
  const ids: Record<string, string> = {};
  for (const cat of CATEGORIES) {
    const [existing] = await db.select().from(categories).where(eq(categories.slug, cat.slug)).limit(1);
    if (existing) {
      ids[cat.slug] = existing.id;
      continue;
    }
    const cover = await uploadImage(cat.cover, `categories/seed-${cat.slug}.jpg`);
    const [inserted] = await db
      .insert(categories)
      .values({
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        sortOrder: cat.sortOrder,
        imageR2Key: cover.key,
        imageAltText: cat.name,
        imageContentType: cover.contentType,
        imageByteSize: cover.byteSize,
        imageBlurDataUrl: cover.blurDataUrl,
        imageVariantWidths: cover.variantWidths,
      })
      .returning({ id: categories.id });
    ids[cat.slug] = inserted.id;
    console.log(`Seeded category: ${cat.name}`);
  }
  return ids;
}

type Item = {
  category: string;
  name: string;
  typeLabel: string;
  color: string;
  price: number;
  code: string;
  sizes: string[];
  description: string;
  badge?: string;
  /** Draft items are created but hidden from the storefront. */
  draft?: boolean;
  /** First image is the primary one. */
  images: Array<{ file: string; alt: string }>;
  featured?: boolean;
};

const APPAREL_SIZES = ["S", "M", "L", "XL"];

// NOTE: prices are placeholders until the client confirms their price list (editable in admin).
const ITEMS: Item[] = [
  {
    category: "shalwar-kameez", name: "Espresso Kameez Shalwar", typeLabel: "Kameez Shalwar", color: "Espresso", price: 12500, code: "KS-ESP", sizes: APPAREL_SIZES, featured: true, badge: "New",
    description: "A clean, collared kameez shalwar in deep espresso brown. Easy through the body with a relaxed shalwar, made to be worn from the office to dinner.",
    images: [{ file: "kameez-espresso.jpg", alt: "Man in an espresso brown kameez shalwar" }, { file: "detail-kameez-collar.jpg", alt: "Collar detail of the espresso kameez" }, { file: "detail-kameez-shalwar.jpg", alt: "Shalwar detail of the espresso kameez shalwar" }],
  },
  {
    category: "shalwar-kameez", name: "Noir Kameez Shalwar with Waistcoat", typeLabel: "Kameez Shalwar & Waistcoat", color: "Noir", price: 18500, code: "KS-NOI", sizes: APPAREL_SIZES, featured: true, badge: "New",
    description: "Black kameez shalwar layered with a structured waistcoat with patch pockets. A complete, sharp look in one set.",
    images: [{ file: "kameez-noir-waistcoat.jpg", alt: "Man in a black kameez shalwar with waistcoat" }, { file: "detail-waistcoat.jpg", alt: "Waistcoat detail" }, { file: "detail-noir-shalwar.jpg", alt: "Black shalwar detail" }],
  },
  {
    category: "shirts", name: "Ivory Patchwork Camp Collar Shirt", typeLabel: "Shirt", color: "Ivory", price: 7500, code: "SH-IVP", sizes: APPAREL_SIZES, featured: true, badge: "New",
    description: "A short-sleeve camp collar shirt in ivory with contrast block-print patchwork panels. Relaxed fit.",
    images: [{ file: "camp-collar-shirt.jpg", alt: "Ivory camp collar shirt with black patchwork" }, { file: "camp-collar-shirt-back.jpg", alt: "Back of the ivory patchwork shirt" }, { file: "detail-patch.jpg", alt: "Patchwork detail" }],
  },
  {
    category: "shirts", name: "Ivory Sashiko Tee", typeLabel: "T-Shirt", color: "Ivory", price: 5500, code: "TE-SAS", sizes: APPAREL_SIZES, featured: true,
    description: "An oversized ivory tee with hand-stitched sashiko panels and an indigo patch.",
    images: [{ file: "ivory-sashiko-tee.jpg", alt: "Ivory tee with sashiko stitching" }, { file: "detail-sashiko.jpg", alt: "Sashiko stitching detail" }],
  },
  {
    category: "shirts", name: "Ivory Crane Tee", typeLabel: "T-Shirt", color: "Ivory", price: 5500, code: "TE-CRA", sizes: APPAREL_SIZES,
    description: "An ivory tee with an embroidered crane across the back and quilted stitch panel.",
    images: [{ file: "ivory-crane-tee-back.jpg", alt: "Back of the ivory tee with an embroidered crane" }, { file: "detail-crane.jpg", alt: "Embroidered crane detail" }],
  },
  {
    category: "shirts", name: "Oxblood Paisley Tee", typeLabel: "T-Shirt", color: "Oxblood", price: 5500, code: "TE-PAI", sizes: APPAREL_SIZES, featured: true,
    description: "A deep oxblood tee with tonal paisley embroidery along the hem.",
    images: [{ file: "oxblood-paisley-tee.jpg", alt: "Oxblood tee with paisley embroidery" }, { file: "oxblood-paisley-tee-back.jpg", alt: "Back of the oxblood paisley tee" }, { file: "detail-paisley.jpg", alt: "Paisley embroidery detail" }],
  },
  {
    category: "shirts", name: "Sage Tree Tee", typeLabel: "T-Shirt", color: "Sage", price: 5500, code: "TE-TRE", sizes: APPAREL_SIZES,
    description: "A sage green tee with an embroidered tree and stitched panels on the back.",
    images: [{ file: "sage-tree-tee.jpg", alt: "Sage green tee with an embroidered tree" }, { file: "detail-tree.jpg", alt: "Embroidered tree detail" }],
  },
  {
    category: "shirts", name: "Sage Wave Tee", typeLabel: "T-Shirt", color: "Sage", price: 5500, code: "TE-WAV", sizes: APPAREL_SIZES,
    description: "A sage green tee with a tonal wave appliqué across the chest.",
    images: [{ file: "sage-wave-tee.jpg", alt: "Sage green tee with a wave applique" }, { file: "detail-wave.jpg", alt: "Wave applique detail" }],
  },
  {
    category: "pants", name: "Olive Cargo Pants", typeLabel: "Cargo Pants", color: "Olive", price: 7900, code: "PA-CAR", sizes: ["30", "32", "34", "36"], featured: true,
    description: "Wide-leg cargo pants in olive with utility side pockets.",
    images: [{ file: "pants-cargo.jpg", alt: "Olive wide-leg cargo pants" }, { file: "detail-cargo.jpg", alt: "Cargo pocket detail" }],
  },
  {
    category: "accessories", name: "Tan Leather Belt", typeLabel: "Belt", color: "Tan", price: 3500, code: "AC-BEL", sizes: ["One size"],
    description: "A full-grain style tan leather belt with a brushed brass buckle.",
    images: [{ file: "acc-belt.jpg", alt: "Tan leather belt with brass buckle" }],
  },
  {
    category: "accessories", name: "Tan Leather Bifold Wallet", typeLabel: "Wallet", color: "Tan", price: 4500, code: "AC-BIF", sizes: ["One size"], draft: true,
    description: "A slim bifold wallet in tan leather with embossed branding.",
    images: [{ file: "acc-bifold.jpg", alt: "Tan leather bifold wallet" }],
  },
  {
    category: "accessories", name: "Black Leather Card Holder", typeLabel: "Card Holder", color: "Black", price: 2500, code: "AC-CAR", sizes: ["One size"], draft: true,
    description: "A slim card holder in black leather.",
    images: [{ file: "acc-cardholder.jpg", alt: "Black leather card holder" }],
  },
];

async function seedProducts(categoryIds: Record<string, string>) {
  const seededAt = Date.now();
  for (const [position, item] of ITEMS.entries()) {
    const slug = slugify(item.name);
    const [existing] = await db.select().from(products).where(eq(products.slug, slug)).limit(1);

    // A previous run that died half-way leaves a product row without variants / photos. Treat that as
    // "not seeded yet": finish the missing parts instead of skipping the product forever.
    let productId = existing?.id;
    let needsVariants = !existing;
    let needsImages = !existing;
    let have = new Set<number>();
    if (existing) {
      const [variantRow] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, existing.id)).limit(1);
      const haveImages = await db.select({ sortOrder: productImages.sortOrder }).from(productImages).where(eq(productImages.productId, existing.id));
      have = new Set(haveImages.map((row) => row.sortOrder));
      needsVariants = !variantRow;
      needsImages = have.size < item.images.length; // a product with only some of its pictures gets the missing ones
      if (!needsVariants && !needsImages) continue;
      console.log(`Repairing partially seeded product: ${item.name}`);
    }

    // Upload photos first so a failed upload never leaves a published product behind.
    const stored = needsImages
      ? await Promise.all(item.images.map((image, index) => (have.has(index) ? Promise.resolve(null) : uploadImage(image.file, `products/seed-${slug}-${index + 1}.jpg`))))
      : [];

    if (!productId) {
      const [product] = await db
        .insert(products)
        .values({
          categoryId: categoryIds[item.category],
          name: item.name,
          slug,
          typeLabel: item.typeLabel,
          shortDescription: `${item.typeLabel} in ${item.color.toLowerCase()}.`,
          description: item.description,
          status: item.draft ? "draft" : "published",
          featured: item.featured ?? false,
          badge: item.badge ?? null,
          primaryColour: item.color,
          gender: "male",
          countryOfOrigin: "Pakistan",
          // Staggered so the storefront (newest first) lists products in the order of ITEMS above.
          publishedAt: new Date(seededAt - position * 60_000),
        })
        .returning({ id: products.id });
      productId = product.id;
    }

    if (needsVariants) {
      await db.insert(productVariants).values(
        item.sizes.map((size, index) => ({
          productId: productId as string,
          name: item.sizes.length > 1 ? `${item.color} / ${size}` : item.color,
          sku: `NA-${item.code}-${size.replace(/\s+/g, "").toUpperCase()}`,
          color: item.color,
          size,
          price: item.price,
          stockQuantity: 20,
          isDefault: index === 0,
          status: "active",
        })),
      );
    }

    for (const [index, image] of item.images.entries()) {
      const file = stored[index];
      if (!file) continue;
      await db.insert(productImages).values({
        productId: productId as string,
        r2Key: file.key,
        altText: image.alt,
        contentType: file.contentType,
        byteSize: file.byteSize,
        width: file.width,
        height: file.height,
        sortOrder: index,
        isPrimary: index === 0,
        blurDataUrl: file.blurDataUrl,
        variantWidths: file.variantWidths,
      });
    }
    console.log(`Seeded product: ${item.name}`);
  }
}

async function seedBanners() {
  const [existing] = await db.select().from(campaignSlides).limit(1);
  if (existing) return;

  const storefront = await uploadImage("banner-storefront.jpg", "campaign/seed-storefront.jpg");
  // 9:16 mobile crop centred on the Nure Asmir wordmark.
  const mobile = await uploadImage("banner-storefront.jpg", "campaign/seed-storefront-mobile.jpg", { left: 650, top: 0, width: 432, height: 768 });
  await db.insert(campaignSlides).values({
    r2Key: storefront.key,
    altText: "Nure Asmir men's wear storefront",
    contentType: storefront.contentType,
    byteSize: storefront.byteSize,
    eyebrow: "",
    headline: "",
    body: "",
    ctaLabel: "Shop now",
    ctaHref: "/shop",
    sortOrder: 0,
    blurDataUrl: storefront.blurDataUrl,
    variantWidths: storefront.variantWidths,
    mobileR2Key: mobile.key,
    mobileContentType: mobile.contentType,
    mobileByteSize: mobile.byteSize,
    mobileBlurDataUrl: mobile.blurDataUrl,
    mobileVariantWidths: mobile.variantWidths,
  });

  const soon = await uploadImage("banner-coming-soon.jpg", "campaign/seed-coming-soon.jpg");
  await db.insert(campaignSlides).values({
    r2Key: soon.key,
    altText: "Nure Asmir — shirts, pants, shalwar kameez and accessories",
    contentType: soon.contentType,
    byteSize: soon.byteSize,
    eyebrow: "",
    headline: "",
    body: "",
    ctaLabel: "Shop now",
    ctaHref: "/shop",
    sortOrder: 1,
    blurDataUrl: soon.blurDataUrl,
    variantWidths: soon.variantWidths,
  });
  console.log("Seeded homepage banners.");
}

async function main() {
  await seedAdmin();
  await seedSiteSettings();
  const categoryIds = await seedCategories();
  await seedDeliveryZones();
  await seedProducts(categoryIds);
  await seedBanners();
  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
