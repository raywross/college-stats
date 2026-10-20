import { getData } from "@/lib/data";
import { handleMcpBody, isJsonRpcRequest, MCP_LATEST_PROTOCOL, negotiateProtocol, RPC } from "@/lib/api/mcp";
import { datasetStamp } from "@/lib/api/public";
import { CORS_HEADERS, json, limitFor, originOf, preflight, tooMany } from "@/lib/api/http";

/**
 * Quad's MCP endpoint, `POST /mcp` (this file also serves `/api/mcp`; `app/mcp/route.ts` re-exports it). Stateless
 * Streamable HTTP: every request is answered as JSON, no session, no server-to-client stream (GET is 405), DELETE is a
 * no-op 200 so clients that end sessions don't see an error. specs/product/assistants.md.
 */
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET() {
  return new Response("This MCP server answers POST requests only (no server-initiated stream). See /connect.", {
    status: 405,
    headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS, DELETE", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function DELETE() {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "Parse error: the body must be JSON." } }, { status: 400 });
  }
  // Only tool calls count against the limiter: a client's initialize and tools/list are free.
  const messages = Array.isArray(body) ? body : [body];
  const calls = messages.filter((m) => isJsonRpcRequest(m) && m.method === "tools/call").length;
  const limit = limitFor(request.headers, calls);
  if (!limit.ok) return tooMany(limit.retryAfter);

  const data = await getData();
  const requested = messages.find((m) => isJsonRpcRequest(m) && m.method === "initialize") as { params?: { protocolVersion?: unknown } } | undefined;
  const protocol = requested ? negotiateProtocol(requested.params?.protocolVersion) : (request.headers.get("mcp-protocol-version") ?? MCP_LATEST_PROTOCOL);
  const response = handleMcpBody(body, { data, origin: originOf(request) });
  const headers = { "Mcp-Protocol-Version": protocol, "Cache-Control": "no-store" };
  if (response === null) return new Response(null, { status: 202, headers: { ...CORS_HEADERS, ...headers } });
  return json(response, { headers, stamp: datasetStamp(data) });
}
