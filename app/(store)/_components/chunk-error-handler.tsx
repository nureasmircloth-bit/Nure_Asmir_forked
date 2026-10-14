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
    // Counts reloads for this tab, so a chunk that stays missing can never trap the visitor in a reload loop (at most 2 reloads a minute,
    // never twice within 10 seconds). The count lives in sessionStorage; when storage is blocked, window.name (which survives a reload)
    // carries a marker instead, so a missing chunk still ends after one reload.
    const MARK = "na-chunk-reloaded";
    function reloadOnce() {
      try {
        const now = Date.now();
        const recent = (JSON.parse(sessionStorage.getItem("na-chunk-reloads") ?? "[]") as number[]).filter((time) => now - time < 60_000);
        if (recent.length >= 2 || (recent.length > 0 && now - recent[recent.length - 1] < 10_000)) return;
        sessionStorage.setItem("na-chunk-reloads", JSON.stringify([...recent, now]));
      } catch {
        if (window.name.includes(MARK)) return;
        window.name = `${window.name} ${MARK}`.trim();
      }
      window.location.reload();
    }
    function isChunkFailure(name: string, message: string) {
      return (
        name === "ChunkLoadError" ||
        /Loading chunk .* failed/i.test(message) ||
        /Failed to fetch dynamically imported module/i.test(message) ||
        /Failed to load module script/i.test(message)
      );
    }
    function onError(event: Event) {
      // An exception is an ErrorEvent; a <script> that fails to load is a plain Event with the script as its target.
      if (event instanceof ErrorEvent) {
        if (isChunkFailure(event.error?.name ?? "", event.message ?? "")) reloadOnce();
        return;
      }
      const target = event.target;
      if (target instanceof HTMLScriptElement && /\/_next\/static\/chunks\//.test(target.src)) reloadOnce();
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { name?: unknown; message?: unknown } | string | null | undefined;
      const name = typeof reason === "object" && reason ? String(reason.name ?? "") : "";
      const message = typeof reason === "string" ? reason : typeof reason === "object" && reason ? String(reason.message ?? "") : "";
      if (isChunkFailure(name, message)) reloadOnce();
    }

    window.addEventListener("error", onError, true); // capture: resource-load errors do not bubble
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
