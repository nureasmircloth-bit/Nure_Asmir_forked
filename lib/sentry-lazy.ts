import { holdUntilReady, sentryState } from "./sentry-state";

/**
 * Reports an error to Sentry without making the error screens carry the Sentry code: it is fetched only when something actually broke.
 * If Sentry has not finished starting yet (the first seconds after a page opens), the error waits in a small queue and is sent the moment it is ready.
 */
export function reportError(error: unknown): void {
  if (!sentryState.ready) {
    holdUntilReady(error);
    return;
  }
  void import("@sentry/nextjs").then((sentry) => sentry.captureException(error)).catch(() => undefined);
}
