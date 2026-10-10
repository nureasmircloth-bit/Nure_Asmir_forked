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

/** The training lab's own menu group (shown only on the training site). */
const LAB_GROUP: NavGroup = {
  label: "Training lab",
  items: [
    { href: "/admin/training", label: "Lessons", icon: "info", exact: true },
    { href: "/admin/training/labs", label: "Guided labs", icon: "sparkle" },
  ],
};

/** The real admin does not host the lessons or the practice any more: they live on the training site, reached by one link. */
const NAV_WITHOUT_TRAINING: NavGroup[] = NAV.map((group) => ({ ...group, items: group.items.filter((item) => item.href !== "/admin/training") }));

/** Renders role-specific admin navigation with active-page markers and pending counts; on the training site it adds the lessons and labs, in the real admin a link to the training site. */
export function NavLinks({ counts, role, lab, trainingUrl }: { counts: Partial<Record<"orders" | "refunds" | "stock", number>>; role?: string; lab?: boolean; trainingUrl?: string }) {
  const pathname = usePathname() || "";
  return (
    <nav className="adm-nav" aria-label="Main">
      {(role === "developer" ? DEV_NAV : lab ? [NAV_WITHOUT_TRAINING[0], LAB_GROUP, ...NAV_WITHOUT_TRAINING.slice(1)] : NAV_WITHOUT_TRAINING).map((group, index) => (
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
      {trainingUrl && !lab && role !== "developer" && (
        <div style={{ display: "grid", gap: 2 }}>
          <p className="adm-nav-label">Learn</p>
          <a href={trainingUrl} target="_blank" rel="noopener noreferrer" title="Training lab: lessons, guided labs and a practice copy of this admin">
            <Icon name="sparkle" />
            <span className="adm-nav-text">Training lab</span>
            <Icon name="external" size={14} />
          </a>
        </div>
      )}
    </nav>
  );
}
