/**
 * Quad's MCP server (specs/product/assistants.md): a stateless Model Context Protocol server over the public college
 * data, JSON-RPC 2.0 over one POST (the Streamable HTTP transport's request path, answering JSON rather than an event
 * stream). Seven read-only tools: `search` and `fetch` in the shape ChatGPT's deep research expects, `find_colleges`,
 * `college_facts`, `compare_colleges`, `explore_colleges`, and `glossary`. Nothing here imports the estimate or the
 * planner: an assistant gets the same cited facts a visitor gets, never a level or odds.
 *
 * Pure: `handleMcpMessage(message, ctx)` takes a parsed JSON-RPC message and a context (the dataset and origin) and
 * returns the response object, or null for a notification. The route (app/api/mcp/route.ts) does the HTTP.
 */
import type { Dataset } from "@/lib/dataset";
import {
  collegeFacts,
  compareColleges,
  exploreColleges,
  factsAsText,
  findColleges,
  glossary,
  resolveCollege,
  SECTION_TITLES,
  clampLimit,
  ATTRIBUTION,
} from "./public";

export const MCP_SERVER_NAME = "quad";
export const MCP_SERVER_VERSION = "1.0.0";
/** Protocol revisions this server speaks; the newest is offered when a client asks for one it doesn't know. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
export const MCP_LATEST_PROTOCOL = MCP_PROTOCOL_VERSIONS[0];

export const MCP_INSTRUCTIONS = [
  "Quad is a college planning site with cleaned, cross-checked data on about 1,900 four-year U.S. colleges: admissions, test ranges, cost, aid, outcomes, students, academics, each value with its source and year.",
  "Use find_colleges to turn a name into a unit_id, college_facts for one college, compare_colleges for two to four, explore_colleges to filter the whole set the way Quad's Explore page does, and glossary for what a term means.",
  "Repeat the source and year Quad gives beside each number, and link the college's Quad page. Quad never gives admission odds, chances, or a probability for a person, and this server has no access to anyone's account or plan.",
].join(" ");

type JsonRpcId = string | number | null;
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpContext {
  data: Dataset;
  origin: string;
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: McpContext) => ToolResult;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function ok(value: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}
function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

const TOOLS: readonly ToolDef[] = [
  {
    name: "search",
    title: "Search colleges",
    description: "Find colleges by name or nickname. Returns ids to pass to fetch. (ChatGPT deep-research shape.)",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "A college name, nickname, or part of one." } }, required: ["query"] },
    run: (args, ctx) => {
      const results = findColleges(ctx.data, ctx.origin, str(args.query), { limit: 10 }).map((c) => ({
        id: c.unit_id,
        title: `${c.name} (${c.city}, ${c.state})`,
        url: c.url,
      }));
      return ok({ results });
    },
  },
  {
    name: "fetch",
    title: "Fetch a college",
    description: "Every fact Quad shows for one college, as text with a source and year per value, by the id search returned. (ChatGPT deep-research shape.)",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The college's unit_id from search." } }, required: ["id"] },
    run: (args, ctx) => {
      const s = resolveCollege(ctx.data, str(args.id));
      if (!s) return fail(`No college with id ${JSON.stringify(str(args.id))}. Use search first.`);
      const facts = collegeFacts(ctx.data, s, ctx.origin);
      return ok({
        id: s.unit_id,
        title: s.name,
        text: factsAsText(facts),
        url: facts.college.url,
        metadata: { city: facts.college.city, state: facts.college.state, type: facts.college.type, selectivity: facts.college.selectivity, attribution: ATTRIBUTION },
      });
    },
  },
  {
    name: "find_colleges",
    title: "Find colleges by name",
    description: "Quad's own search: aliases and nicknames first ('Cal', 'UVA'), then name prefixes. Returns unit_id, location, acceptance rate, enrollment, and Quad's selectivity tier in words.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, nickname, or part of a name." },
        state: { type: "string", description: "Optional two-letter state to keep results to." },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 8 },
      },
      required: ["query"],
    },
    run: (args, ctx) => ok({ colleges: findColleges(ctx.data, ctx.origin, str(args.query), { state: str(args.state) || null, limit: clampLimit(args.limit, 8, 25) }) }),
  },
  {
    name: "college_facts",
    title: "A college's facts, cited",
    description: `One college's facts as Quad's Compare table shows them, grouped (${SECTION_TITLES.join(", ")}), each value with its source and year. Give a unit_id, or a name and the best match is used.`,
    inputSchema: {
      type: "object",
      properties: {
        college: { type: "string", description: "A unit_id (preferred) or a college name." },
        sections: { type: "array", items: { type: "string" }, description: `Optional subset of sections, by title (${SECTION_TITLES.join(", ")}) or topic key (admissions, students, academics, cost, outcomes).` },
      },
      required: ["college"],
    },
    run: (args, ctx) => {
      const s = resolveCollege(ctx.data, str(args.college));
      if (!s) return fail(`Quad doesn't know ${JSON.stringify(str(args.college))}. Try find_colleges.`);
      const sections = Array.isArray(args.sections) ? args.sections.map(str).filter(Boolean) : undefined;
      return ok(collegeFacts(ctx.data, s, ctx.origin, sections) as unknown as Record<string, unknown>);
    },
  },
  {
    name: "compare_colleges",
    title: "Compare two to four colleges",
    description: "The Compare table: one row per metric with each college's value and the year it describes. Pass two to four unit_ids.",
    inputSchema: { type: "object", properties: { unit_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } }, required: ["unit_ids"] },
    run: (args, ctx) => {
      const ids = Array.isArray(args.unit_ids) ? args.unit_ids.map(str) : [];
      const result = compareColleges(ctx.data, ctx.origin, ids);
      return "error" in result ? fail(result.error) : ok(result as unknown as Record<string, unknown>);
    },
  },
  {
    name: "explore_colleges",
    title: "Explore colleges by filters",
    description:
      "Filter and sort all colleges with the same parameters as Quad's Explore page: states, regions, types (public, private-nonprofit, private-forprofit), sizes (small, medium, large, xl), minAR/maxAR (admit rate %), minSAT/maxSAT, minACT/maxACT, minCost/maxCost (dollars), policy (required, optional, blind), selectivity (elite, highly_selective, very_selective, selective, accessible, open), setting (city, suburb, town, rural), field (2-digit CIP family), near (ZIP) with within (miles), sortBy (applicants, name, acceptance_rate, enrollment, sat, avg_cost, net_price, earnings, grad_rate, …), sortDir. Lists are comma-separated; flags are 1.",
    inputSchema: {
      type: "object",
      properties: {
        filters: { type: "object", additionalProperties: { type: "string" }, description: "Explore's query parameters as strings, e.g. {\"states\":\"GA,NC\",\"maxAR\":\"40\",\"sortBy\":\"net_price\"}." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        page: { type: "integer", minimum: 1, default: 1 },
      },
    },
    run: (args, ctx) => {
      const raw = args.filters && typeof args.filters === "object" && !Array.isArray(args.filters) ? (args.filters as Record<string, unknown>) : {};
      const filters: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(raw)) if (v !== undefined && v !== null) filters[k] = str(v);
      return ok(exploreColleges(ctx.data, ctx.origin, filters, { limit: clampLimit(args.limit, 20, 50), page: Number(args.page) || 1 }) as unknown as Record<string, unknown>);
    },
  },
  {
    name: "glossary",
    title: "What a term means",
    description: "Quad's glossary: admissions, test scores, students and access, cost and outcomes, school types, how Quad measures, data sources. Optionally narrow to one term.",
    inputSchema: { type: "object", properties: { term: { type: "string", description: "A glossary key (acceptance-rate) or part of a term." } } },
    run: (args) => ok({ terms: glossary(str(args.term) || null) }),
  },
];

export function toolList(): { tools: Record<string, unknown>[] } {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { title: t.title, ...READ_ONLY },
    })),
  };
}

export function toolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

function error(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}
function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result: value };
}

/** JSON-RPC error codes the server uses. */
export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

export function isJsonRpcRequest(m: unknown): m is JsonRpcRequest {
  return !!m && typeof m === "object" && (m as JsonRpcRequest).jsonrpc === "2.0" && typeof (m as JsonRpcRequest).method === "string";
}

/** The protocol version to answer with: the client's when known, else this server's newest. */
export function negotiateProtocol(requested: unknown): string {
  return typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_LATEST_PROTOCOL;
}

/** One message in, one response out; null when the message is a notification (no id) and needs no reply. */
export function handleMcpMessage(message: unknown, ctx: McpContext): JsonRpcResponse | null {
  if (!isJsonRpcRequest(message)) return error(null, RPC.invalidRequest, "Not a JSON-RPC 2.0 request.");
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  if (isNotification) return null; // notifications/initialized, notifications/cancelled: nothing to send back
  const params = (message.params && typeof message.params === "object" ? message.params : {}) as Record<string, unknown>;
  switch (message.method) {
    case "initialize":
      return result(id, {
        protocolVersion: negotiateProtocol(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: "Quad", version: MCP_SERVER_VERSION },
        instructions: MCP_INSTRUCTIONS,
      });
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, toolList());
    case "tools/call": {
      const name = str(params.name);
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return error(id, RPC.invalidParams, `Unknown tool: ${name}`);
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
      try {
        return result(id, tool.run(args, ctx));
      } catch (e) {
        return result(id, fail(`${name} failed: ${e instanceof Error ? e.message : "unknown error"}`));
      }
    }
    case "resources/list":
      return result(id, { resources: [] });
    case "resources/templates/list":
      return result(id, { resourceTemplates: [] });
    case "prompts/list":
      return result(id, { prompts: [] });
    default:
      return error(id, RPC.methodNotFound, `Method not found: ${message.method}`);
  }
}

/** A whole body: one message or (older clients) a batch. Returns what to send, or null when nothing is due. */
export function handleMcpBody(body: unknown, ctx: McpContext): JsonRpcResponse | JsonRpcResponse[] | null {
  if (Array.isArray(body)) {
    if (body.length === 0) return error(null, RPC.invalidRequest, "Empty batch.");
    const out = body.map((m) => handleMcpMessage(m, ctx)).filter((r): r is JsonRpcResponse => r !== null);
    return out.length ? out : null;
  }
  return handleMcpMessage(body, ctx);
}
