import { logError } from "@/lib/error-log";
import { reportServerError } from "@/lib/sentry-server";

// Called by Next.js for every error thrown while rendering or handling a request on the server.
/** Logs and reports server request errors, excluding known stream closures during page rendering. */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string; renderSource?: string },
) {
  const err = (error ?? {}) as { name?: string; message?: string; stack?: string; digest?: string };
  // The visitor left (closed the tab, lost signal, pressed reload) while the page was still streaming – not a fault of ours. A message alone is
  // not proof, so it must be the exact wording AND happen while a page is being rendered; any other error with these words is still reported.
  if (context.routeType === "render" && /^(The destination stream closed early|Connection closed)\.?$/.test((err.message ?? "").trim())) return;
  // A browser, extension or scanner sent a damaged "router state" header with its request (nothing in our pages makes one). The request is simply refused; the exact wording during a page render is not a fault of ours.
  if (context.routeType === "render" && (err.message ?? "").trim() === "The router state header was sent but could not be parsed.") return;
  logError({ source: `${context.routeType}:${context.routePath}`, message: `${err.name ?? "Error"}: ${err.message ?? "Unknown error"}`, path: request.path, stack: err.stack });
  reportServerError(err, {
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
}
