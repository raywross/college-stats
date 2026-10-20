import "server-only";
/**
 * The MCP endpoint's request handler (specs/product/data-api.md "MCP server"; app/api/mcp/route.ts mounts it for GET,
 * POST, and DELETE): `mcp-handler`'s createMcpHandler over lib/api/mcp.ts's tools, behind `withMcpAuth` with the same
 * key check as the REST API (lib/api/auth.ts verifyApiKeyToken, one lookup path).
 *
 * - Every HTTP request to /api/mcp is one key check, counted by api_key_use() against the day and spending one token
 *   of the per-minute bucket, with endpoint "mcp". A tools/call is one request, so each tool call counts once; the
 *   protocol's own requests (initialize, tools/list, a GET probe) count too.
 * - No key, or a bad one → 401 with `WWW-Authenticate: Bearer …, resource_metadata="…"` (withMcpAuth's RFC 9728
 *   challenge) and the API's error body. Over a limit → 429 with Retry-After; the key check unavailable → 503: the
 *   same errors as REST (withMcpAuth alone would turn both into 401s).
 * - The verified key reaches tool callbacks as `ctx.http.authInfo` (`clientId` is the key id, `extra.userId` its
 *   owner); each tool call records `api_request` (transport "mcp", endpoint "mcp.<tool>"), and a refused request
 *   records one with endpoint "mcp" and no key.
 *
 * Server only (Supabase, telemetry, the dataset). Tests pass `deps` to inject the key lookup and the recorder.
 */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { getData, getHistory, getHistoryFiles } from "@/lib/data";
import { recordApiRequest, verifyApiKeyToken, type ApiAuthDeps, type ApiAuthResult } from "@/lib/api/auth";
import { apiError, authFailure } from "@/lib/api/respond";
import { MCP_INSTRUCTIONS, registerQuadTools, type McpToolContext, type RecordToolCall } from "@/lib/api/mcp";
import { MCP_PATH } from "@/lib/api/routes";

/** The key check's endpoint for every MCP request (api_key_use()'s p_endpoint; refused requests' api_request.endpoint). */
export const MCP_AUTH_ENDPOINT = "mcp";

/**
 * Where withMcpAuth's 401 challenge points (`resource_metadata`): the RFC 9728 document for this resource, at the
 * path-inserted well-known URL (RFC 9728 §3.1) so its `resource` is the MCP endpoint itself. Served by
 * app/.well-known/oauth-protected-resource/api/mcp/route.ts with no authorization servers (keys, not OAuth, for now).
 */
export const MCP_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

export interface McpRouteDeps {
  /** The key check's injectables (tests: `lookup` instead of Supabase, a clock, a bucket). */
  auth?: ApiAuthDeps;
  /** api_request's recorder (default lib/api/auth.ts recordApiRequest). */
  record?: RecordToolCall;
  /** The tools' data (default getData(), getHistory, getHistoryFiles). */
  context?: () => Promise<McpToolContext>;
}

type AuthFailure = Extract<ApiAuthResult, { ok: false }>;

async function defaultContext(): Promise<McpToolContext> {
  return {
    data: await getData(),
    getHistory,
    getHistoryMeta: async () => (await getHistoryFiles())?.meta ?? null,
  };
}

/**
 * verifyToken for withMcpAuth: the key check for a bare bearer token. The principal becomes the request's AuthInfo
 * (`clientId` the key id, no scopes, `extra.userId` the owner); a refusal answers undefined (withMcpAuth's 401) and
 * hands the reason to `onFailure`, so the route can send 429 and 503 as themselves.
 */
export async function verifyMcpToken(token: string | undefined, deps?: ApiAuthDeps, onFailure?: (f: AuthFailure) => void): Promise<AuthInfo | undefined> {
  const auth = await verifyApiKeyToken(token ?? null, MCP_AUTH_ENDPOINT, deps);
  if (!auth.ok) {
    onFailure?.(auth);
    return undefined;
  }
  return { token: token!, clientId: auth.principal.keyId, scopes: [], extra: { userId: auth.principal.userId } };
}

/** The /api/mcp handler: the key check, then the MCP server. */
export function createMcpRoute(deps: McpRouteDeps = {}): (request: Request) => Promise<Response> {
  const record = deps.record ?? recordApiRequest;
  const mcp = createMcpHandler((server) => registerQuadTools(server, { context: deps.context ?? defaultContext, record }), {
    serverInfo: { name: "quad", version: "1.0.0" },
    instructions: MCP_INSTRUCTIONS,
  });

  return async (request) => {
    // Per request: what the key check said when it refused, so a 429 or 503 isn't flattened into withMcpAuth's 401.
    const refused: { failure?: AuthFailure } = {};
    const gated = withMcpAuth(mcp, (_req, token) => verifyMcpToken(token, deps.auth, (f) => (refused.failure = f)), {
      required: true,
      resourceMetadataPath: MCP_RESOURCE_METADATA_PATH,
    });
    const res = await gated(request);
    const failure = refused.failure;
    if (!failure) return res;
    try {
      await record({ endpoint: MCP_AUTH_ENDPOINT, status: failure.status, transport: "mcp", keyId: null });
    } catch {
      // Telemetry never fails a request.
    }
    if (failure.status !== 401) return authFailure(failure);
    // withMcpAuth's challenge (with resource_metadata) and the API's own error body, which says how to get a key.
    const challenge = res.headers.get("WWW-Authenticate") ?? authFailure(failure).headers.get("WWW-Authenticate") ?? "Bearer";
    return apiError(401, failure.code, failure.message, { "WWW-Authenticate": challenge });
  };
}
