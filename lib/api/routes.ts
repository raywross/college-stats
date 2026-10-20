/**
 * The Data API's endpoint and MCP tool table (specs/product/data-api.md "Endpoints", "MCP server"): one row per
 * `/api/v1` route and one per MCP tool. The OpenAPI document (lib/api/openapi.ts, served at /api/v1/openapi.json), the
 * /developers page, and the tests all read this table, so documentation is generated from code. tests/api-v1.test.mts
 * checks that every `app/api/v1/**\/route.ts` file has a row here and every row has its file.
 *
 * Rows are added, never reordered or renamed: an `id` is also the telemetry endpoint name (`api_request.endpoint`)
 * and the `p_endpoint` api_key_use() receives. `path` is the full URL path; a path parameter is written `{name}`, and
 * its folder is `[name]` (`/api/v1/schools/{id}` is app/api/v1/schools/[id]/route.ts).
 *
 * Pure module (no imports), so tests and the docs page load it directly.
 */

export const API_BASE = "/api/v1";
export const MCP_PATH = "/api/mcp";

export interface ApiParam {
  name: string;
  in: "query" | "path";
  type: "string" | "integer" | "number" | "boolean";
  description: string;
  required?: boolean;
  enum?: readonly string[];
}

export interface ApiRoute {
  /** Stable id: "me", "schools.get". Also the telemetry endpoint and api_key_use()'s p_endpoint. */
  id: string;
  method: "GET";
  /** Full URL path, path parameters as `{name}`. */
  path: string;
  summary: string;
  description: string;
  params: ApiParam[];
  /** Needs `Authorization: Bearer quad_…` (every route but the OpenAPI document). */
  keyed: boolean;
  responseExample?: unknown;
}

export interface McpToolDoc {
  name: string;
  summary: string;
  inputs: ApiParam[];
}

export const API_ROUTES: readonly ApiRoute[] = [
  {
    id: "me",
    method: "GET",
    path: `${API_BASE}/me`,
    summary: "The key you're calling with",
    description:
      "The key's owner (display name, never the email), the key's name, prefix, and tier, how many requests it has made today, and the limits. Use it to check a key works.",
    params: [],
    keyed: true,
    responseExample: {
      owner: { display_name: "Ana" },
      key: { id: "3f0c2a0e-6f7b-4c39-9d55-0d1f1f3b8a10", name: "My notebook", prefix: "quad_ab3k9x2m", tier: "account" },
      used_today: 12,
      limits: { per_day: 5000, per_minute: 60, keys_per_user: 5 },
    },
  },
  {
    id: "meta",
    method: "GET",
    path: `${API_BASE}/meta`,
    summary: "About the dataset",
    description:
      "When the dataset was retrieved, every source with its publisher and edition, the release year of each federal release, when each source is expected to publish next, and counts. What the Data page shows.",
    params: [],
    keyed: true,
  },
  {
    id: "fields",
    method: "GET",
    path: `${API_BASE}/fields`,
    summary: "The field registry",
    description:
      "Every public field the dataset stores or the site calculates: its path, label, topic, default source and release year, and, for calculated values, the formula and inputs. Fields used only inside Quad's own method are never listed.",
    params: [{ name: "topic", in: "query", type: "string", description: "Only fields of this topic (e.g. admissions, prices, outcomes)." }],
    keyed: true,
  },
  {
    id: "openapi",
    method: "GET",
    path: `${API_BASE}/openapi.json`,
    summary: "This API as OpenAPI 3.1",
    description: "The OpenAPI 3.1 document for every endpoint, generated from the same table as the Developers page. No key needed.",
    params: [],
    keyed: false,
  },
];

/** The MCP server's tools (lib/api/mcp.ts registers them; the MCP build adds one row per tool). */
export const MCP_TOOLS: readonly McpToolDoc[] = [];

/** The file that serves a route: `/api/v1/schools/{id}` → `app/api/v1/schools/[id]/route.ts`. */
export function routeFilePath(route: Pick<ApiRoute, "path">): string {
  return `app${route.path.replace(/\{(\w+)\}/g, "[$1]")}/route.ts`;
}

/** The row for an id; throws for an unknown one (a typo in a route file fails its first request and the tests). */
export function apiRoute(id: string): ApiRoute {
  const route = API_ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`No API route "${id}" in lib/api/routes.ts`);
  return route;
}
