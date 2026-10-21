import "server-only";
/**
 * The wrapper every keyed `/api/v1` route handler uses (specs/product/data-api.md "Endpoints"), so routes write no auth
 * code: check the key for the route's id (lib/api/routes.ts), answer a failure with its error (401 / 429 / 503), run
 * the handler with the awaited params and the key's principal, and record `api_request` with the status sent.
 *
 *   export const GET = withApiKey<{ id: string }>("schools.get", async ({ request, params, principal }) => {
 *     const { getSchoolById, getMeta } = await getData();
 *     …
 *     return apiJson(body, { retrieved: getMeta().retrieved, request });
 *   });
 *
 * A handler that throws answers 500 internal (logged, never the error's text). Server only.
 */
import { authenticateApiRequest, recordApiRequest, type ApiAuthDeps, type ApiPrincipal } from "@/lib/api/auth";
import { apiError, authFailure } from "@/lib/api/respond";

export interface ApiHandlerArgs<P> {
  request: Request;
  params: P;
  principal: ApiPrincipal;
}

export type ApiHandler<P> = (args: ApiHandlerArgs<P>) => Response | Promise<Response>;

/** The route handler for `endpointId`: key check, handler, telemetry. `deps` is for tests (an injected key lookup). */
export function withApiKey<P extends Record<string, string> = Record<string, string>>(
  endpointId: string,
  handler: ApiHandler<P>,
  deps?: ApiAuthDeps,
): (request: Request, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    const auth = await authenticateApiRequest(request, endpointId, deps);
    if (!auth.ok) {
      await recordApiRequest({ endpoint: endpointId, status: auth.status, transport: "rest", keyId: null });
      return authFailure(auth);
    }
    let res: Response;
    try {
      res = await handler({ request, params: ((await context?.params) ?? {}) as P, principal: auth.principal });
    } catch (err) {
      console.error(`[api] ${endpointId} failed:`, err);
      res = apiError(500, "internal", "Something went wrong answering this request. Try again shortly.");
    }
    await recordApiRequest({ endpoint: endpointId, status: res.status, transport: "rest", keyId: auth.principal.keyId });
    return res;
  };
}

/** A `400 bad_request` naming the parameter (specs/product/data-api.md "Errors"). */
export function badRequest(param: string, message: string): Response {
  return apiError(400, "bad_request", `${param}: ${message}`);
}

/** A `404 not_found`. */
export function notFound(message: string): Response {
  return apiError(404, "not_found", message);
}
