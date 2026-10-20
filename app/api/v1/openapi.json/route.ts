import { openApiDocument } from "@/lib/api/openapi";
import { json, originOf, preflight, PUBLIC_CACHE } from "@/lib/api/http";

/** GET /api/v1/openapi.json: the public endpoints' OpenAPI 3.1 document, with this deployment as its server. */
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET(request: Request) {
  return json(openApiDocument(originOf(request)), { cache: PUBLIC_CACHE });
}
