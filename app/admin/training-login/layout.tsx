export const metadata = { title: "Training lab", robots: { index: false, follow: false } };

/** Gives the training entrance its own tab title (the page itself is a client component, which cannot set one). */
export default function TrainingLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
