"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; icon: IconName; countKey?: "orders" | "refunds" | "stock"; exact?: boolean };
export type NavGroup = { label?: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  { items: [{ href: "/admin", label: "Home", icon: "home", exact: true }] },
  {
    label: "Sell",
    items: [
      { href: "/admin/orders", label: "Orders", icon: "orders", countKey: "orders" },
      { href: "/admin/refunds", label: "Refunds", icon: "refund", countKey: "refunds" },
      { href: "/admin/products", label: "Products", icon: "box" },
      { href: "/admin/stock", label: "Stock", icon: "grid", countKey: "stock" },
      { href: "/admin/collections", label: "Categories", icon: "folder" },
    ],
  },
  {
    label: "Grow",
    items: [
      { href: "/admin/flash-sales", label: "Flash sales", icon: "bolt" },
      { href: "/admin/coupons", label: "Discount codes", icon: "tag" },
      { href: "/admin/messages", label: "Messages", icon: "send" },
      { href: "/admin/subscribers", label: "Email list", icon: "mail" },
    ],
  },
  {
    label: "Your website",
    items: [
      { href: "/admin/pictures", label: "Website pictures", icon: "image" },
      { href: "/admin/story", label: "Our story page", icon: "sheet" },
      { href: "/admin/faqs", label: "Questions & answers", icon: "info" },
      { href: "/admin/locations", label: "Shop locations", icon: "pin" },
      { href: "/admin/delivery", label: "Delivery charges", icon: "truck" },
      { href: "/admin/settings", label: "Settings", icon: "settings" },
      { href: "/admin/training", label: "Training", icon: "info" },
    ],
  },
];

/** What a developer login sees: only the technical page. */
const DEV_NAV: NavGroup[] = [{ items: [{ href: "/admin/developer", label: "Developer", icon: "settings", exact: true }] }];

export const ALL_PAGES = NAV.flatMap((group) => group.items);

export function NavLinks({ counts, role, practice }: { counts: Partial<Record<"orders" | "refunds" | "stock", number>>; role?: string; practice?: boolean }) {
  const pathname = usePathname() || "";
  return (
    <nav className="adm-nav" aria-label="Main">
      {(role === "developer" ? DEV_NAV : NAV).map((group, index) => (
        <div key={group.label ?? index} style={{ display: "grid", gap: 2 }}>
          {group.label && <p className="adm-nav-label">{group.label}</p>}
          {group.items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = item.countKey ? counts[item.countKey] : 0;
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} prefetch={false} title={item.label}>
                <Icon name={item.icon} />
                <span className="adm-nav-text">{item.label}</span>
                {count ? <span className="count" aria-label={`${count} waiting`}>{count > 99 ? "99+" : count}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
      {practice && role !== "developer" && (
        <div style={{ display: "grid", gap: 2 }}>
          <p className="adm-nav-label">Learn</p>
          <Link href="/admin/practice" prefetch={false} title="Practice shop" aria-current={pathname.startsWith("/admin/practice") ? "page" : undefined}>
            <Icon name="sparkle" />
            <span className="adm-nav-text">Practice shop</span>
          </Link>
        </div>
      )}
    </nav>
  );
}
