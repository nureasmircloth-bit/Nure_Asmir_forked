// Creates (or resets) the developer login that opens the technical dashboard at /admin/developer.
//   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs scripts/create-developer.ts [email]
// A strong password is generated and printed once (or taken from DEVELOPER_PASSWORD, and then never printed); only its hash is stored. Run it again to reset the password.
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adminOwners } from "../db/schema";
import { hashPassword } from "../lib/auth/password";

async function main() {
  const email = (process.argv[2] || process.env.DEVELOPER_EMAIL || "developer@nureasmir.com").trim().toLowerCase();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const chosen = process.env.DEVELOPER_PASSWORD;
  if (chosen && chosen.length < 12) throw new Error("DEVELOPER_PASSWORD must be at least 12 characters.");
  const password = chosen || Array.from(randomBytes(18), (byte) => alphabet[byte % alphabet.length]).join("");
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(adminOwners).where(eq(adminOwners.email, email)).limit(1);
  if (existing && existing.role !== "developer") throw new Error(`${email} is already an ${existing.role} account – choose another email.`);
  if (existing) await db.update(adminOwners).set({ passwordHash }).where(eq(adminOwners.email, email));
  else await db.insert(adminOwners).values({ email, displayName: "Developer", passwordHash, role: "developer" });
  console.log(`${existing ? "Password reset for" : "Created"} developer login`);
  console.log(`  email:    ${email}`);
  if (!chosen) console.log(`  password: ${password}`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
