import { cache } from "react";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { storeLocations } from "@/db/schema";

/** Most shops a brand like this will ever have; keeps the footer and the Contact page readable. */
export const MAX_LOCATIONS = 30;

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Please type a name for this shop.").max(80),
  address: z.string().trim().min(5, "Please type the full address.").max(300),
  city: z.string().trim().max(60).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
  hours: z.string().trim().max(120).optional().default(""),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isMain: z.boolean().optional(),
  active: z.boolean().optional(),
});

export type PublicLocation = { id: string; name: string; address: string; city: string; phone: string; hours: string; latitude: number | null; longitude: number | null; isMain: boolean };

/** Shops shown on the website: active ones, main shop first. */
export const getStoreLocations = cache(async (): Promise<PublicLocation[]> => {
  try {
    const rows = await db.select().from(storeLocations).where(eq(storeLocations.active, true)).orderBy(asc(storeLocations.sortOrder), asc(storeLocations.createdAt));
    return rows
      .map((row) => ({ id: row.id, name: row.name, address: row.address, city: row.city, phone: row.phone, hours: row.hours, latitude: row.latitude, longitude: row.longitude, isMain: row.isMain }))
      .sort((a, b) => Number(b.isMain) - Number(a.isMain));
  } catch (err) {
    console.warn("Failed to fetch store locations, using empty list:", err);
    return [];
  }
});
