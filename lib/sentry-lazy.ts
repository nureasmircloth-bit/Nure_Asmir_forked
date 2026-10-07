/** Reports an error to Sentry without making the error screens carry the Sentry code: it is fetched only when something actually broke. */
export function reportError(error: unknown): void {
  void import("@sentry/nextjs").then((sentry) => sentry.captureException(error)).catch(() => undefined);
}
