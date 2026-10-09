import { z } from "zod";
import { sandboxRoomMessage } from "@/lib/sandbox";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { discountCodes } from "@/db/schema";
import { getAdminUser } from "@/lib/auth/admin-auth";
import { auditLogEntry } from "@/lib/admin/audit";
import { isUniqueViolation } from "@/lib/db/errors";

export const dynamic = "force-dynamic";

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const createSchema = z
  .object({
    code: z.string().trim().min(1, "Code is required."),
    description: z.string().trim().optional().nullable(),
    type: z.enum(["percentage", "fixed"]),
    value: z.coerce.number().int().positive(),
    minOrderAmount: z.coerce.number().int().min(0).optional(),
    maxDiscountAmount: z.coerce.number().int().positive().optional().nullable(),
    maxRedemptions: z.coerce.number().int().positive().optional().nullable(),
    appliesToDelivery: z.boolean().optional(),
    startsAt: z.string().optional().nullable(),
    expiresAt: z.string().optional().nullable(),
    active: z.boolean().optional(),
  })
  .refine((data) => data.type !== "percentage" || data.value <= 100, {
    message: "Percentage discounts cannot exceed 100.",
    path: ["value"],
  });

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(discountCodes).orderBy(desc(discountCodes.createdAt));
  return Response.json({ coupons: rows });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const full = await sandboxRoomMessage("coupons"); // practice shop only: a small limit on how much can be created
  if (full) return Response.json({ error: full }, { status: 400 });

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid coupon payload." }, { status: 400 });
  }
  const data = parsed.data;
  const code = data.code.toUpperCase();

  const [existing] = await db.select({ id: discountCodes.id }).from(discountCodes).where(eq(discountCodes.code, code));
  if (existing) return Response.json({ error: "A coupon with this code already exists." }, { status: 409 });

  let row;
  try {
    [row] = await db
      .insert(discountCodes)
      .values({
        code,
        description: data.description?.trim() || null,
        type: data.type,
        value: data.value,
        minOrderAmount: data.minOrderAmount ?? 0,
        maxDiscountAmount: data.maxDiscountAmount ?? null,
        maxRedemptions: data.maxRedemptions ?? null,
        appliesToDelivery: data.appliesToDelivery ?? false,
        startsAt: toDate(data.startsAt),
        expiresAt: toDate(data.expiresAt),
        active: data.active ?? true,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ error: "A coupon with this code already exists." }, { status: 409 });
    }
    throw error;
  }

  await auditLogEntry({ actorEmail: admin.email, action: "coupon.create", entityType: "discount-code", entityId: row.id, detail: { code } });

  return Response.json({ coupon: row }, { status: 201 });
}
