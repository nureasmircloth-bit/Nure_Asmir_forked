import Image from "next/image";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { productVariants, refundRequests } from "@/db/schema";
import { requireAdminUser } from "@/lib/auth/admin-auth";
import { orderTabCounts } from "@/lib/admin/orders-query";
import { cookies } from "next/headers";
import { Icon } from "../_ui/icons";
import { ToastProvider } from "../_ui/client";
import { NavLinks } from "../_ui/nav";
import { SearchPalette } from "../_ui/palette";
import { SideToggle } from "../_ui/side-toggle";
import { ThemeMenu } from "../_ui/theme-menu";
import { LogoutButton } from "./logout-button";
import { PushToggle } from "./push-toggle";
import { SandboxBar } from "./sandbox-bar";
import { isSandbox, practiceAvailable, sandboxHits } from "@/lib/sandbox";

async function sidebarCounts() {
  try {
    const [orders, [refunds], [stock]] = await Promise.all([
      orderTabCounts(),
      db.select({ n: sql<number>`count(*)::int` }).from(refundRequests).where(eq(refundRequests.status, "requested")),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(productVariants)
        .where(sql`${productVariants.status} = 'active' and ${productVariants.stockQuantity} - ${productVariants.reservedQuantity} <= ${productVariants.lowStockThreshold}`),
    ]);
    return { orders: orders.action, refunds: refunds?.n ?? 0, stock: stock?.n ?? 0 };
  } catch (error) {
    console.error("sidebar counts failed", error);
    return { orders: 0, refunds: 0, stock: 0 };
  }
}

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminUser("/admin");
  const jar = await cookies();
  const counts = await sidebarCounts();
  const themeCookie = jar.get("adm-theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "night" ? themeCookie : "auto";
  const text = jar.get("adm-text")?.value === "large" ? "large" : "normal";
  const side = jar.get("adm-side")?.value === "collapsed" ? "collapsed" : "open";
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL || "/";
  // The practice shop: show how much practice is left today. The real admin offers a way in once the practice tables exist.
  const practice = isSandbox();
  const hits = practice ? await sandboxHits() : null;
  const offerPractice = !practice && practiceAvailable() && user.role === "owner";

  return (
    <ToastProvider>
      {hits && <SandboxBar left={hits.left} limit={hits.limit} />}
      <div className="adm-shell" data-side={side} data-sandbox={practice ? "1" : undefined}>
        <aside className="adm-side">
          <div className="adm-brand">
            <Image src="/logo-icon.png" alt="" width={38} height={38} priority />
            <div className="adm-brand-text">
              <strong>Nure Asmir</strong>
              <span>Shop manager</span>
            </div>
            <SideToggle initialCollapsed={side === "collapsed"} />
          </div>
          <div className="adm-side-scroll">
            <NavLinks counts={counts} role={user.role} practice={offerPractice} />
          </div>
          <div className="adm-side-foot">
            <div className="adm-push">
              <PushToggle />
            </div>
            <div className="adm-user">
              <span>{(user.displayName ?? user.email).slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{user.displayName ?? user.email}</strong>
                <small>{user.role === "owner" ? "Owner" : user.role === "developer" ? "Developer" : user.role}</small>
              </div>
            </div>
            <LogoutButton />
          </div>
        </aside>
        <div className="adm-main">
          <div className="adm-top">
            <SearchPalette />
            <div className="adm-top-right">
              <a className="a-btn a-btn-sm" href={storeUrl} target="_blank" rel="noopener noreferrer" title="Open your shop the way customers see it">
                <Icon name="external" size={16} /> View shop
              </a>
              <ThemeMenu initialTheme={theme} initialText={text} />
            </div>
          </div>
          <main className="adm-page">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
