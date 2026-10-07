import type { Metadata } from "next";

// A private step of buying, not a page to find on Google.
export const metadata: Metadata = { title: "Track your order", robots: { index: false, follow: true } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
