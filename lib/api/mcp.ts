/**
 * The Data API's MCP server (specs/product/data-api.md "MCP server"): the seven tools an assistant calls on a person's
 * behalf, each a thin call into lib/api/serialize.ts over the dataset `getData()` loads, so the MCP tools, the REST
 * routes, and the site can never disagree. Nothing here does its own arithmetic, and no hidden field
 * (lib/fields.ts HIDDEN_FIELDS) can come out: every college goes through publicSchool / schoolSummary / schoolLineage /
 * compareTable, every field list through fieldRegistry.
 *
 *   createMcpHandler((server) => registerQuadTools(server, { context, record }), { instructions: MCP_INSTRUCTIONS })
 *
 * Tools answer JSON in the result's text (and as `structuredContent` where the answer is small); a value returned
 * outside a whole record carries its `cited` lineage, so an assistant can quote the source and year. Errors are tool
 * results with `isError: true` and a plain sentence (unknown college, bad input), never a protocol error.
 *
 * Pure module: the dataset, the history loader, and the telemetry call are passed in (app/api/mcp/route.ts through
 * lib/api/mcp-route.ts wires the real ones), so tests call `runTool` without HTTP or Supabase.
 */
import { z } from "zod";
import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { Dataset } from "../dataset";
import type { School } from "../types";
import type { Cited } from "../lineage.ts";
import { SERIES, SERIES_KEYS, historySources, type HistoryMeta, type SchoolHistory, type SeriesKey } from "../history.ts";
import { aliasKey } from "../aliases.ts";
import { parseFilters } from "../params.ts";
import type { MetricKey } from "../metrics.ts";
import {
  COMPARE_DEFAULT_METRICS,
  compareTable,
  datasetMeta,
  fieldRegistry,
  fieldTopics,
  isHiddenPath,
  publicSchool,
  publicSeriesKeys,
  schoolLineage,
  schoolSummary,
  seriesDefinitions,
  type SchoolSummary,
} from "./serialize.ts";

/** The attribution the terms ask for (specs/product/data-api.md "Terms"); the date is the dataset's `retrieved`. */
export const MCP_ATTRIBUTION = "Data: Quad, from College Scorecard and IPEDS";

/** What the server tells a client about itself on initialize. */
export const MCP_INSTRUCTIONS =
  "Quad's college dataset: about 1,900 U.S. four-year colleges with admissions, cost, aid, outcomes, and year-by-year history, every value traced to its source and year. " +
  "Find a college with search_colleges (or get_college by name), then read it with get_college, get_lineage, get_history, or compare_colleges. " +
  `Quote values with their source and year from the returned lineage, and credit "${MCP_ATTRIBUTION}" with the dataset's retrieved date (get_dataset_info). ` +
  "College-reported (Common Data Set) values are the colleges' own publications: cite them as such.";

/** What every tool needs: the dataset, and the history shards and build metadata (null when history isn't built). */
export interface McpToolContext {
  data: Dataset;
  getHistory: (unitId: string) => Promise<SchoolHistory | null>;
  getHistoryMeta?: () => Promise<HistoryMeta | null>;
}

/** A tool's answer plus the HTTP-like status recorded as `api_request.status` (200, 400 bad input, 404 not found, 500). */
export interface ToolOutcome {
  status: number;
  result: CallToolResult;
}

/* ------------------------------------------------------------------ */
/* Input schemas (zod 4)                                               */
/* ------------------------------------------------------------------ */

const unitId = z.string().regex(/^\d{3,8}$/, "a unit_id is the college's IPEDS number, digits only (e.g. 166027)");
const unitIdField = unitId.describe("The college's IPEDS unit_id, e.g. \"166027\" (from search_colleges).");
const PUBLIC_TOPICS = fieldTopics() as [string, ...string[]];
const PUBLIC_METRICS = COMPARE_DEFAULT_METRICS as readonly MetricKey[] as [MetricKey, ...MetricKey[]];
const SERIES_ENUM = SERIES_KEYS.filter((k) => !isHiddenPath(SERIES[k].field)) as [SeriesKey, ...SeriesKey[]];

export const SEARCH_LIMIT = { default: 10, max: 50 } as const;
export const COMPARE_LIMIT = { min: 2, max: 10 } as const;

const searchInput = z.object({
  query: z.string().trim().min(1).max(200).optional().describe("A college's name, short name or nickname (\"UGA\"), city, or state."),
  states: z
    .array(z.string().regex(/^[A-Za-z]{2}$/, "a two-letter state code"))
    .max(60)
    .optional()
    .describe("Only colleges in these states: two-letter codes, e.g. [\"CA\", \"NY\"]."),
  types: z.array(z.enum(["public", "private-nonprofit", "private-forprofit"])).optional().describe("Only these kinds of college."),
  sizes: z
    .array(z.enum(["small", "medium", "large", "xl"]))
    .optional()
    .describe("Undergraduate enrollment: small (under 5,000), medium (5,000 to 15,000), large (15,000 to 30,000), xl (30,000 and up)."),
  min_admit_rate: z.number().min(0).max(100).optional().describe("Lowest acceptance rate, in percent (0 to 100)."),
  max_admit_rate: z.number().min(0).max(100).optional().describe("Highest acceptance rate, in percent (0 to 100)."),
  min_sat: z.number().int().min(400).max(1600).optional().describe("Colleges whose middle-50% SAT range reaches at least this total."),
  max_sat: z.number().int().min(400).max(1600).optional().describe("Colleges whose middle-50% SAT range starts at or below this total."),
  min_act: z.number().int().min(1).max(36).optional().describe("Colleges whose middle-50% ACT range reaches at least this composite."),
  max_act: z.number().int().min(1).max(36).optional().describe("Colleges whose middle-50% ACT range starts at or below this composite."),
  limit: z.number().int().min(1).max(SEARCH_LIMIT.max).optional().describe(`How many colleges to return (default ${SEARCH_LIMIT.default}, at most ${SEARCH_LIMIT.max}).`),
});

const getCollegeInput = z.object({
  unit_id: unitIdField.optional(),
  name: z.string().trim().min(1).max(200).optional().describe("The college's name or a short name (\"MIT\"), when you don't have its unit_id."),
  fields: z
    .array(z.string().max(80))
    .max(50)
    .optional()
    .describe("Only these top-level keys of the record (e.g. [\"admissions\", \"cost\"]); unit_id and name always come back."),
});

const compareInput = z.object({
  unit_ids: z.array(unitId).min(COMPARE_LIMIT.min).max(COMPARE_LIMIT.max).describe(`${COMPARE_LIMIT.min} to ${COMPARE_LIMIT.max} colleges' unit_ids.`),
  metrics: z.array(z.enum(PUBLIC_METRICS)).min(1).optional().describe("Which metrics to compare (default: all of them; naming a few keeps the answer short)."),
});

const historyInput = z.object({
  unit_id: unitIdField,
  series: z.array(z.enum(SERIES_ENUM)).min(1).optional().describe("Which year-by-year series (default: every series the college has)."),
});

const lineageInput = z.object({
  unit_id: unitIdField,
  fields: z
    .array(z.string().max(80))
    .max(100)
    .optional()
    .describe("Only these field paths or prefixes (e.g. [\"admissions\", \"cost.sticker\"]; see list_fields). Without it, every value's lineage comes back, which is long."),
});

const fieldsInput = z.object({
  topic: z.enum(PUBLIC_TOPICS).optional().describe("Only fields of this topic."),
});

const datasetInput = z.object({});

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function ok(body: Record<string, unknown>, structured: boolean): ToolOutcome {
  const text = JSON.stringify(body);
  return { status: 200, result: { content: [{ type: "text", text }], ...(structured ? { structuredContent: body } : {}) } };
}

/** A tool error as the client sees it: `isError` and one plain sentence. */
export function toolError(status: 400 | 404 | 500, message: string): ToolOutcome {
  return { status, result: { content: [{ type: "text", text: message }], isError: true } };
}

/** One citation and the colleges whose value it is (`cited` in search and compare results). */
export type GroupedCitation = Cited & { unit_ids: string[] };

/**
 * Per-college lineage (schoolLineage's records, unchanged) folded by field: each distinct record once, with the
 * colleges it cites. Most colleges share a field's default source, so ten colleges' citations cost about one's.
 */
export function groupCitations(perCollege: readonly (readonly [string, Record<string, Cited>])[]): Record<string, GroupedCitation[]> {
  const out: Record<string, GroupedCitation[]> = {};
  const seen = new Map<string, GroupedCitation>();
  for (const [unitIdValue, records] of perCollege) {
    for (const [field, cited] of Object.entries(records)) {
      const id = `${field}\u0000${JSON.stringify(cited)}`;
      const group = seen.get(id);
      if (group) group.unit_ids.push(unitIdValue);
      else {
        const created: GroupedCitation = { ...cited, unit_ids: [unitIdValue] };
        seen.set(id, created);
        (out[field] ??= []).push(created);
      }
    }
  }
  return out;
}

const notFound = (id: string) => toolError(404, `No college with unit_id ${id} in Quad's dataset. Find one with search_colleges.`);

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "input"}: ${i.message}`).join("; ");
}

/* ------------------------------------------------------------------ */
/* Tool logic                                                          */
/* ------------------------------------------------------------------ */

/** The field a search row's acceptance_rate is (schoolSummary reads admissions.acceptance_rate). */
const ACCEPTANCE_FIELD = "admissions.acceptance_rate";

/** search_colleges: Explore's filters (lib/params.ts parseFilters over lib/dataset.ts getSchools), in Explore's order. */
function searchColleges(args: z.infer<typeof searchInput>, { data }: McpToolContext): ToolOutcome {
  const list = (v: readonly string[] | undefined) => (v?.length ? v.join(",") : undefined);
  const num = (v: number | undefined) => (v === undefined ? undefined : String(v));
  const filters = parseFilters({
    q: args.query,
    states: list(args.states?.map((s) => s.toUpperCase())),
    types: list(args.types),
    sizes: list(args.sizes),
    minAR: num(args.min_admit_rate),
    maxAR: num(args.max_admit_rate),
    minSAT: num(args.min_sat),
    maxSAT: num(args.max_sat),
    minACT: num(args.min_act),
    maxACT: num(args.max_act),
  });
  const matches = data.getSchools(filters);
  const picked = matches.slice(0, args.limit ?? SEARCH_LIMIT.default);
  const meta = data.getMeta();
  const cited = groupCitations(picked.map((s) => [s.unit_id, schoolLineage(s, meta, [ACCEPTANCE_FIELD])] as const));
  return ok({ total: matches.length, items: picked.map(schoolSummary), cited }, true);
}

/** How a name resolves (get_college): one college, several to choose from, or none. */
export type NameResolution = { kind: "one"; school: School } | { kind: "many"; candidates: SchoolSummary[] } | { kind: "none" };

export const NAME_CANDIDATES = 10;

/**
 * A name through the same scorer as search (lib/dataset.ts searchSchools, lib/aliases.ts scoreSchool): an exact name
 * (ignoring case) that only one college has wins, then an exact short name or nickname (the scorer's best, "ASU" →
 * Arizona State), then a lone candidate. Anything else is ambiguous and answers the candidates.
 */
export function resolveCollegeName(name: string, data: Pick<Dataset, "searchSchools" | "getSchoolById">): NameResolution {
  const hits = data
    .searchSchools(name, NAME_CANDIDATES)
    .map((h) => ({ school: data.getSchoolById(h.id), matched: h.matched }))
    .filter((h): h is { school: School; matched: string | undefined } => h.school !== null);
  if (hits.length === 0) return { kind: "none" };
  const wanted = name.trim().toLowerCase();
  const sameName = hits.filter((h) => h.school.name.toLowerCase() === wanted);
  if (sameName.length === 1) return { kind: "one", school: sameName[0].school };
  if (sameName.length > 1) return { kind: "many", candidates: sameName.map((h) => schoolSummary(h.school)) };
  const key = aliasKey(name);
  // Hits come best first, so the first exact short name is the scorer's pick among the colleges sharing it.
  const byAlias = key ? hits.find((h) => h.matched !== undefined && aliasKey(h.matched) === key) : undefined;
  if (byAlias) return { kind: "one", school: byAlias.school };
  if (hits.length === 1) return { kind: "one", school: hits[0].school };
  return { kind: "many", candidates: hits.map((h) => schoolSummary(h.school)) };
}

/** get_college: the PublicSchool record, by unit_id or by name. */
function getCollege(args: z.infer<typeof getCollegeInput>, { data }: McpToolContext): ToolOutcome {
  if (args.unit_id) {
    const school = data.getSchoolById(args.unit_id);
    return school ? ok(publicSchool(school, args.fields) as Record<string, unknown>, false) : notFound(args.unit_id);
  }
  if (!args.name) return toolError(400, "Give unit_id or name.");
  const found = resolveCollegeName(args.name, data);
  if (found.kind === "none") return toolError(404, `No college matches "${args.name}". Try search_colleges with a shorter name or a city.`);
  if (found.kind === "many") {
    return ok(
      {
        ambiguous: true,
        query: args.name,
        message: `Several colleges match "${args.name}". Call get_college again with one of these unit_ids.`,
        candidates: found.candidates,
      },
      true,
    );
  }
  return ok(publicSchool(found.school, args.fields) as Record<string, unknown>, false);
}

/** compare_colleges: lib/metrics.ts values with each college's percentile rank and the national median, plus lineage. */
function compareColleges(args: z.infer<typeof compareInput>, ctx: McpToolContext): ToolOutcome {
  const { data } = ctx;
  const ids = [...new Set(args.unit_ids)];
  if (ids.length < COMPARE_LIMIT.min) return toolError(400, `unit_ids: give at least ${COMPARE_LIMIT.min} different colleges.`);
  const schools = data.getSchoolsByIds(ids);
  const missing = ids.filter((id) => !schools.some((s) => s.unit_id === id));
  if (missing.length) return toolError(404, `No college with unit_id ${missing.join(", ")} in Quad's dataset. Find one with search_colleges.`);
  const metrics = compareTable(schools, data, args.metrics);
  const meta = data.getMeta();
  const fields = [...new Set(metrics.map((m) => m.field))];
  const cited = groupCitations(schools.map((s) => [s.unit_id, schoolLineage(s, meta, fields)] as const));
  return ok({ colleges: schools.map(schoolSummary), metrics, cited }, true);
}

/** get_history: the college's year-by-year shard, narrowed to the series asked for, with their definitions and sources. */
async function getHistoryTool(args: z.infer<typeof historyInput>, ctx: McpToolContext): Promise<ToolOutcome> {
  const { data } = ctx;
  if (!data.getSchoolById(args.unit_id)) return notFound(args.unit_id);
  const history = await ctx.getHistory(args.unit_id);
  if (!history) return toolError(404, `Quad has no year-by-year history for unit_id ${args.unit_id}.`);
  const have = publicSeriesKeys(history);
  const keys = args.series ? have.filter((k) => args.series!.includes(k)) : have;
  if (args.series && keys.length === 0) return toolError(404, `This college has none of those series. It has: ${have.join(", ")}.`);
  const series = Object.fromEntries(keys.map((k) => [k, history.series[k]]));
  // The same definitions /api/v1/schools/{id}/history serves (lib/api/serialize.ts), so the two surfaces can't drift.
  const definitions = seriesDefinitions(keys);
  const hmeta = ctx.getHistoryMeta ? await ctx.getHistoryMeta() : null;
  const sources = hmeta ? historySources(keys, hmeta, data.getMeta()) : [];
  return ok({ unit_id: history.unit_id, series, definitions, ...(history.repeated ? { repeated: history.repeated } : {}), sources }, false);
}

/** get_lineage: the resolved Cited record of every value the college has (schoolLineage), as /lineage serves it. */
function getLineage(args: z.infer<typeof lineageInput>, { data }: McpToolContext): ToolOutcome {
  const school = data.getSchoolById(args.unit_id);
  if (!school) return notFound(args.unit_id);
  return ok({ unit_id: school.unit_id, fields: schoolLineage(school, data.getMeta(), args.fields) }, false);
}

/** list_fields: the public registry, as /fields serves it. */
function listFields(args: z.infer<typeof fieldsInput>, { data }: McpToolContext): ToolOutcome {
  const fields = fieldRegistry(data.getMeta()).filter((f) => !args.topic || f.topic === args.topic);
  return ok({ fields }, false);
}

/** get_dataset_info: /meta. */
function getDatasetInfo(_args: z.infer<typeof datasetInput>, { data }: McpToolContext): ToolOutcome {
  return ok(datasetMeta({ meta: data.getMeta(), calendar: data.getReleaseCalendar(), summary: data.getDatasetSummary() }) as unknown as Record<string, unknown>, true);
}

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

const ATTRIBUTE = `Credit "${MCP_ATTRIBUTION}" with the dataset's retrieved date.`;

interface ToolDef<S extends z.ZodObject> {
  title: string;
  description: string;
  inputSchema: S;
  run: (args: z.infer<S>, ctx: McpToolContext) => ToolOutcome | Promise<ToolOutcome>;
}

const tool = <S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> => def;

/** The seven tools of specs/product/data-api.md "MCP server", in the spec's order. lib/api/routes.ts MCP_TOOLS documents them. */
export const MCP_TOOL_DEFS = {
  search_colleges: tool({
    title: "Search colleges",
    description: `Find U.S. four-year colleges by name, nickname, or place and Explore's filters (state, kind, size, acceptance rate, SAT and ACT ranges); returns each college's unit_id, name, city, state, kind, and acceptance rate with its source. ${ATTRIBUTE}`,
    inputSchema: searchInput,
    run: searchColleges,
  }),
  get_college: tool({
    title: "Get a college",
    description: `One college's full record (admissions, test scores, cost, aid, outcomes, enrollment, campus) by unit_id or by name; a name that matches several colleges returns the candidates instead. ${ATTRIBUTE}`,
    inputSchema: getCollegeInput,
    run: getCollege,
  }),
  compare_colleges: tool({
    title: "Compare colleges",
    description: `Compare 2 to 10 colleges metric by metric: each value, its percentile rank among all colleges, the national median, and each value's source and year. ${ATTRIBUTE}`,
    inputSchema: compareInput,
    run: compareColleges,
  }),
  get_history: tool({
    title: "Get a college's history",
    description: `A college's year-by-year series (applicants, acceptance rate, prices, aid, enrollment, graduation, and more), each with its definition, any break in its definition, and the federal files behind it. ${ATTRIBUTE}`,
    inputSchema: historyInput,
    run: getHistoryTool,
  }),
  get_lineage: tool({
    title: "Get a college's lineage",
    description: `Where each of a college's values comes from: source, publisher, year, method, and for calculated values the formula and inputs, or for college-reported values the document and quote. ${ATTRIBUTE}`,
    inputSchema: lineageInput,
    run: getLineage,
  }),
  list_fields: tool({
    title: "List fields",
    description: `Every public field in the dataset: its path, label, topic, default source and release year, and the formula behind calculated values. ${ATTRIBUTE}`,
    inputSchema: fieldsInput,
    run: listFields,
  }),
  get_dataset_info: tool({
    title: "About the dataset",
    description: `When the dataset was retrieved, every source with its publisher and edition, each federal release's year, when each source publishes next, and counts. ${ATTRIBUTE}`,
    inputSchema: datasetInput,
    run: getDatasetInfo,
  }),
} as const;

export type McpToolName = keyof typeof MCP_TOOL_DEFS;

/** The tool names in registration order (tests check them against lib/api/routes.ts MCP_TOOLS and the spec). */
export const MCP_TOOL_NAMES = Object.keys(MCP_TOOL_DEFS) as McpToolName[];

/** The telemetry endpoint for a tool call: `mcp.<tool>` (api_request.endpoint). */
export const mcpEndpoint = (name: McpToolName): string => `mcp.${name}`;

/** Runs a tool's logic on arguments its schema already accepted; a throw becomes a 500 tool error (logged, never its text). */
async function execute(name: McpToolName, args: unknown, ctx: McpToolContext): Promise<ToolOutcome> {
  const def = MCP_TOOL_DEFS[name] as unknown as ToolDef<z.ZodObject>;
  try {
    return await def.run(args as z.infer<z.ZodObject>, ctx);
  } catch (err) {
    console.error(`[mcp] ${name} failed:`, err);
    return toolError(500, "Something went wrong answering this. Try again shortly.");
  }
}

/**
 * Validates `args` with the tool's schema and runs it: what a tools/call does, minus HTTP (tests call this). Bad input
 * is a 400 tool error naming the argument; an unknown tool is a 400 too.
 */
export async function runTool(name: string, args: unknown, ctx: McpToolContext): Promise<ToolOutcome> {
  if (!(name in MCP_TOOL_DEFS)) return toolError(400, `No tool named ${name}. Tools: ${MCP_TOOL_NAMES.join(", ")}.`);
  const parsed = MCP_TOOL_DEFS[name as McpToolName].inputSchema.safeParse(args ?? {});
  if (!parsed.success) return toolError(400, `Invalid arguments for ${name}: ${zodMessage(parsed.error)}`);
  return execute(name as McpToolName, parsed.data, ctx);
}

/** The api_request telemetry call (lib/api/auth.ts recordApiRequest in the route). */
export type RecordToolCall = (args: { endpoint: string; status: number; transport: "mcp"; keyId: string | null }) => Promise<void>;

export interface RegisterOptions {
  /** The dataset and history, loaded on a tool's first use (getData() is per instance, so this is cheap). */
  context: () => Promise<McpToolContext>;
  /** Records each tool call as api_request; must not throw (a throw is swallowed anyway). */
  record?: RecordToolCall;
}

/**
 * The createMcpHandler initializer: registers the seven tools. Each callback is wrapped once: it runs the tool, then
 * records `api_request` with `transport: "mcp"`, `endpoint: "mcp.<tool>"`, the tool's status, and the key id
 * (`ctx.http.authInfo.clientId`, set by the route's verifyToken). Telemetry never fails a call.
 */
export function registerQuadTools(server: McpServer, options: RegisterOptions): void {
  for (const name of MCP_TOOL_NAMES) {
    const def = MCP_TOOL_DEFS[name] as unknown as ToolDef<z.ZodObject>;
    server.registerTool(
      name,
      { title: def.title, description: def.description, inputSchema: def.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
      async (args: unknown, ctx: ServerContext): Promise<CallToolResult> => {
        let outcome: ToolOutcome;
        try {
          outcome = await execute(name, args, await options.context());
        } catch (err) {
          console.error(`[mcp] loading the dataset for ${name} failed:`, err);
          outcome = toolError(500, "The dataset couldn't be loaded. Try again shortly.");
        }
        try {
          await options.record?.({ endpoint: mcpEndpoint(name), status: outcome.status, transport: "mcp", keyId: ctx.http?.authInfo?.clientId ?? null });
        } catch {
          // Telemetry never fails a tool call.
        }
        return outcome.result;
      },
    );
  }
}
