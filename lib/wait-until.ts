/** Resolves as soon as `test()` is true, or after `maxMs` at the latest (so a slow or failed picture can never freeze a button). */
export function waitUntil(test: () => boolean, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (test() || performance.now() - started >= maxMs) resolve();
      else window.setTimeout(tick, 40);
    };
    tick();
  });
}

/** True on a data-saver setting or a very slow connection, where pictures should only be fetched when the shopper asks for them. */
export function saveDataMode(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? "");
}
