// Browser-side error + performance monitoring (Sentry project nure-asmir / javascript-nextjs).
// The DSN is public by design; it only allows sending events.
//
// The Sentry browser code is about 140 KB compressed – bigger than everything else the home page needs together – so it is NOT
// part of the first load. Until it has loaded (a moment after the page is interactive) a tiny listener remembers any error, and
// the errors are handed over as soon as Sentry is ready, so nothing is lost.
type SentryModule = typeof import("@sentry/nextjs");

let sentry: SentryModule | null = null;
const early: unknown[] = [];
const remember = (event: ErrorEvent) => void (early.length < 20 && early.push(event.error ?? event.message));
const rememberRejection = (event: PromiseRejectionEvent) => void (early.length < 20 && early.push(event.reason));

const active = process.env.NODE_ENV === "production" && !!process.env.NEXT_PUBLIC_SENTRY_DSN;

if (active && typeof window !== "undefined") {
  window.addEventListener("error", remember);
  window.addEventListener("unhandledrejection", rememberRejection);

  const load = () => {
    void import("@sentry/nextjs").then((module) => {
      module.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        enabled: true,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        // Light sampling keeps the free quota intact while still surfacing slow routes.
        tracesSampleRate: 0.1,
        // Storefront visitors are anonymous shoppers: don't attach identity data, IPs or request bodies.
        dataCollection: { userInfo: false },
        ignoreErrors: [
          // Harmless browser noise.
          "ResizeObserver loop limit exceeded",
          "ResizeObserver loop completed with undelivered notifications.",
          /^Non-Error promise rejection captured/,
        ],
      });
      sentry = module;
      window.removeEventListener("error", remember);
      window.removeEventListener("unhandledrejection", rememberRejection);
      for (const error of early.splice(0)) module.captureException(error);
    });
  };
  const later = () => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(load, { timeout: 6000 }) : window.setTimeout(load, 3000));
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
}

export const onRouterTransitionStart = (...args: Parameters<SentryModule["captureRouterTransitionStart"]>) => sentry?.captureRouterTransitionStart(...args);
