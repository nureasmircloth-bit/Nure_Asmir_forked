import { logError } from "@/lib/error-log";
import { reportServerError } from "@/lib/sentry-server";

// Called by Next.js for every error thrown while rendering or handling a request on the server.
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string; renderSource?: string },
) {
  const err = (error ?? {}) as { name?: string; message?: string; stack?: string; digest?: string };
  // The visitor left (closed the tab, lost signal, pressed reload) while the page was still streaming – not a fault of ours.
  if (/destination stream closed early|^Connection closed\.?$/i.test(err.message ?? "")) return;
  logError({ source: `${context.routeType}:${context.routePath}`, message: `${err.name ?? "Error"}: ${err.message ?? "Unknown error"}`, path: request.path, stack: err.stack });
  reportServerError(err, {
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
}
