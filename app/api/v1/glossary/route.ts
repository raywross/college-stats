import { glossary } from "@/lib/api/public";
import { json, preflight, PUBLIC_CACHE } from "@/lib/api/http";

/** GET /api/v1/glossary?term=acceptance-rate (specs/product/assistants.md). Static text; no limiter needed. */
export const dynamic = "force-static";

export async function OPTIONS() {
  return preflight();
}

export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("term");
  return json({ terms: glossary(term) }, { cache: PUBLIC_CACHE });
}
