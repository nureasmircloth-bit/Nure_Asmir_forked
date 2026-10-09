/**
 * Where errors wait until the error-reporting code has loaded. Sentry's browser code is large, so it is fetched a moment after the page
 * is ready (instrumentation-client.ts). Until then, anything that goes wrong – an uncaught error, or one caught by an error screen
 * (lib/sentry-lazy.ts) – is put here, and handed over the moment Sentry is ready, so nothing is lost.
 */
export const sentryState: { ready: boolean; early: unknown[] } = { ready: false, early: [] };

const MAX_WAITING = 20;

export function holdUntilReady(error: unknown): void {
  if (sentryState.early.length < MAX_WAITING) sentryState.early.push(error);
}
