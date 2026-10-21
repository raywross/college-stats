import { recordApiRequest } from "@/lib/api/auth";
import { buildOpenApi } from "@/lib/api/openapi";
import { API_ROUTES } from "@/lib/api/routes";

/**
 * GET /api/v1/openapi.json (specs/product/data-api.md "Endpoints"): the OpenAPI 3.1 document for the Data API, built
 * from lib/api/routes.ts with the request's origin as its server. The one route without a key; public and cached for
 * an hour (it changes only with a deploy).
 */
export async function GET(request: Request) {
  const doc = buildOpenApi(API_ROUTES, { serverUrl: new URL(request.url).origin });
  const res = Response.json(doc, { headers: { "Cache-Control": "public, max-age=3600" } });
  await recordApiRequest({ endpoint: "openapi", status: res.status, transport: "rest", keyId: null });
  return res;
}
