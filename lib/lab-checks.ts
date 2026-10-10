import { sql } from "drizzle-orm";
import { practiceDb } from "@/db";
import { LAB_CHECKS } from "./lab-check-queries";
import { labById } from "./labs";

type Rows<T> = { rows: T[] };

/** For each step of a lab: has the trainee really done it in the practice shop? Returns null for an unknown lab. */
export async function checkLab(labId: string): Promise<boolean[] | null> {
  const lab = labById(labId);
  const queries = LAB_CHECKS[labId];
  if (!lab || !queries || queries.length !== lab.steps.length) return null;
  const handle = practiceDb();
  const results: boolean[] = [];
  for (const query of queries) {
    const result = (await handle.execute(sql.raw(query))) as unknown as Rows<{ ok: boolean }>;
    results.push(result.rows[0]?.ok === true);
  }
  return results;
}
