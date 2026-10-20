import { createMcpRoute } from "@/lib/api/mcp-route";

/**
 * /api/mcp (specs/product/data-api.md "MCP server"): Quad's MCP server over Streamable HTTP, keyed with the same
 * `Authorization: Bearer quad_…` as the REST API. The tools are lib/api/mcp.ts's; the key check, the 401/429/503
 * answers, and the telemetry are lib/api/mcp-route.ts's. Stateless: GET and DELETE (2025-era session operations)
 * answer 405 once the key checks out.
 */
const handler = createMcpRoute();

export { handler as GET, handler as POST, handler as DELETE };
