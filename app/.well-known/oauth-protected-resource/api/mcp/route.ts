import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

/**
 * The RFC 9728 Protected Resource Metadata for /api/mcp, at the path-inserted well-known URL (RFC 9728 §3.1) that
 * /api/mcp's 401 challenge names in `resource_metadata` (lib/api/mcp-route.ts MCP_RESOURCE_METADATA_PATH). Its
 * `resource` is the MCP endpoint. No authorization servers: the server takes Quad API keys as bearer tokens, made on
 * /account/api-keys, not OAuth tokens (specs/product/data-api.md "Open questions" 1).
 */
const handler = protectedResourceHandler({ authServerUrls: [] });
const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };
