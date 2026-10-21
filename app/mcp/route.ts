import { createPublicMcpRoute } from "@/lib/api/mcp-route";

/**
 * /mcp (specs/product/assistants.md): the same MCP server as /api/mcp with no key, the address the assistants'
 * connector menus take (Claude, ChatGPT, Gemini can't send a header there). Limited per address instead of per key
 * (lib/api/mcp-route.ts createPublicMcpRoute); every tool call is recorded as api_request without a key id.
 */
const handler = createPublicMcpRoute();

export { handler as GET, handler as POST, handler as DELETE };
