"use client";

import { useEffect } from "react";

/**
 * Recovers seamlessly when a user has a tab open during a new production deployment.
 * If a soft navigation requests a component chunk that was replaced on the server,
 * this catches the ChunkLoadError and immediately reloads to the latest build without
 * flashing an unstyled 404 or leaving the user stuck on a broken route.
 */
export function ChunkErrorHandler() {
  useEffect(() => {
    function onError(event: ErrorEvent | PromiseRejectionEvent) {
      const message = "reason" in event ? String(event.reason?.message || event.reason || "") : String(event.message || "");
      if (
        /Loading chunk .* failed/i.test(message) ||
        /ChunkLoadError/i.test(message) ||
        /Failed to fetch dynamically imported module/i.test(message) ||
        /Failed to load module script/i.test(message)
      ) {
        try {
          const lastReload = sessionStorage.getItem("na-last-chunk-reload");
          const now = Date.now();
          if (!lastReload || now - Number(lastReload) > 10000) {
            sessionStorage.setItem("na-last-chunk-reload", String(now));
            window.location.reload();
          }
        } catch {
          window.location.reload();
        }
      }
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    };
  }, []);

  return null;
}
