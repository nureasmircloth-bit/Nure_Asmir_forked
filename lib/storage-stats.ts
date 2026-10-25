import { sql } from "drizzle-orm";
import { db } from "@/db";
import { nowMs } from "@/db/sql-compat";
import { measureStore, r2Bucket, STORAGE_LIMITS, type Backend } from "@/lib/storage";

export type StoreReading = { backend: Backend; bytes: number; objects: number; limitBytes: number; at: string; error?: string };

/** Measures both picture stores and saves the readings (the developer page shows them; uploads use them to pick the emptier store). */
export async function refreshStorageStats(): Promise<StoreReading[]> {
  const readings: StoreReading[] = [];
  for (const backend of ["neon", "r2"] as const) {
    let reading: StoreReading;
    try {
      if (backend === "r2" && !r2Bucket()) throw new Error("R2 is not connected to this Worker yet");
      const measured = await measureStore(backend);
      reading = { backend, ...measured, limitBytes: STORAGE_LIMITS[backend], at: new Date().toISOString() };
    } catch (error) {
      reading = { backend, bytes: 0, objects: 0, limitBytes: STORAGE_LIMITS[backend], at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    }
    readings.push(reading);
    // A failed reading must not tell uploads "this store is empty": keep the previous numbers and only note the problem.
    if (!reading.error) {
      const value = JSON.stringify(reading);
      await db.execute(sql`insert into service_stats (key, value, updated_at) values (${`storage:${backend}`}, ${value}, ${nowMs}) on conflict (key) do update set value = ${value}, updated_at = ${nowMs}`);
    }
  }
  return readings;
}
