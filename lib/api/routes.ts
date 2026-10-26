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
/** The same MCP server without a key, for the assistants' connector menus (specs/product/assistants.md); limited per address. */
export const MCP_PUBLIC_PATH = "/mcp";

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

const query = (name: string, type: ApiParam["type"], description: string, extra: Partial<ApiParam> = {}): ApiParam => ({ name, in: "query", type, description, ...extra });
const idParam: ApiParam = { name: "id", in: "path", type: "string", description: "The college's IPEDS unit id (e.g. 166027 for Harvard).", required: true };
const fieldsParam = (what: string): ApiParam => query("fields", "string", `Comma-separated ${what} to keep.`);

/**
 * Every query parameter /schools reads, in Explore's own names (lib/params.ts parseFilters): an Explore URL's filters
 * work here unchanged. Lists are comma-separated; a flag is "1". tests/api-v1-routes.test.mts checks that every key
 * parseFilters reads is listed and that the sort values are Explore's sort keys.
 */
const SCHOOL_LIST_PARAMS: ApiParam[] = [
  query("q", "string", "Search text: a college's name, nickname, or place."),
  query("states", "string", "Comma-separated two-letter state codes (CA,NY)."),
  query("regions", "string", "Comma-separated regions: Midwest, Northeast, Southeast, Southwest, Territories, West."),
  query("types", "string", "Comma-separated control types: public, private-nonprofit, private-forprofit."),
  query("sizes", "string", "Comma-separated size buckets by undergraduate enrollment: small (under 5,000), medium, large, xl (30,000 or more)."),
  query("minAR", "number", "Lowest acceptance rate, as a percent (10 means 10%). Colleges that don't report one are left out."),
  query("maxAR", "number", "Highest acceptance rate, as a percent (30 means 30%). Colleges that don't report one are left out."),
  query("minSAT", "integer", "Keeps colleges whose middle 50% of SAT totals (sum of sections) reaches at least this."),
  query("maxSAT", "integer", "Keeps colleges whose middle 50% of SAT totals (sum of sections) starts at or below this."),
  query("minACT", "integer", "Keeps colleges whose middle 50% of ACT composites reaches at least this."),
  query("maxACT", "integer", "Keeps colleges whose middle 50% of ACT composites starts at or below this."),
  query("mySAT", "integer", "Your SAT total: keeps colleges whose middle 50% includes it (and test-blind colleges)."),
  query("myACT", "integer", "Your ACT composite: keeps colleges whose middle 50% includes it (and test-blind colleges)."),
  query("minEnroll", "integer", "Fewest undergraduates."),
  query("maxEnroll", "integer", "Most undergraduates."),
  query("minApplicants", "integer", "At least this many applicants at the start of the ten-year window (the Biggest movers floor)."),
  query("minUndergrads", "integer", "At least this many undergraduates at the start of the ten-year window (the Biggest movers floor)."),
  query("maxRatio", "number", "At most this many students per faculty member."),
  query("minFullTimeFaculty", "number", "At least this percent of faculty full-time (70 means 70%)."),
  query("minCost", "integer", "Lowest average total cost a year, in dollars."),
  query("maxCost", "integer", "Highest average total cost a year, in dollars."),
  query("costTrend", "string", "Comma-separated directions of the cost trend to keep: up, steady, down."),
  query("appsTrend", "string", "Comma-separated directions of the applicants trend to keep: up, steady, down."),
  query("divTrend", "string", "Comma-separated directions of the diversity trend to keep: up, steady, down."),
  query("selTrend", "string", "Comma-separated directions of the selectivity trend to keep: up, steady, down."),
  query("balance", "string", "Comma-separated gender balance of undergraduates: women, balanced, men."),
  query("policy", "string", "Comma-separated test policy buckets: required, optional, blind."),
  query("selectivity", "string", "Comma-separated selectivity tiers (the tier shown on a profile), e.g. elite,highly_selective; colleges without a tier are left out."),
  query("fullTime", "string", "1: at most 10% of undergraduates study part-time."),
  query("fewLoans", "string", "1: at most 20% of undergraduates have a federal loan."),
  query("pellGap", "string", "1: the Pell graduation gap is under 5 points."),
  query("national", "string", "1: at least half of first-years come from other states."),
  query("field", "string", "A bachelor's field family (two-digit CIP code, e.g. 11 for computer science); pairs with fieldMin."),
  query("fieldMin", "integer", "With field: at least this many first-major bachelor's degrees a year (default 1)."),
  query("liveOn", "string", "1: first-years must live on campus."),
  query("noFee", "string", "1: no application fee."),
  query("guarantee", "string", "1: offers a tuition guarantee."),
  query("feeWaiver", "string", "1: takes the Common App fee waiver (for everyone, or for U.S. applicants)."),
  query("ed", "string", "1: offers an Early Decision round."),
  query("ed2", "string", "1: offers an Early Decision II round."),
  query("ea", "string", "1: offers Early Action, Early Action II, or Restrictive Early Action."),
  query("noLegacy", "string", "1: legacy status is not considered in admission."),
  query("setting", "string", "Comma-separated campus settings: city, suburb, town, rural."),
  query("research", "string", "Comma-separated research tiers: R1, R2, RCU."),
  query("designation", "string", "Comma-separated designations: hbcu, tribal, land_grant, hsi, pbi, aanapisi, annh, nasnti, women, men."),
  query("opportunity", "string", "1: a Carnegie Opportunity College or University."),
  query("online", "string", "campus (half or fewer of undergraduates take every course online) or mostly (more than half do).", { enum: ["campus", "mostly"] }),
  query("division", "string", "Comma-separated athletic divisions: I-FBS, I-FCS, I, II, III, naia."),
  query("conference", "integer", "An athletic conference's IPEDS code."),
  query("football", "string", "1: has a football team."),
  query("rotc", "string", "Comma-separated ROTC branches on campus: army, navy, air_force."),
  query("ugResearch", "string", "1: offers undergraduate research."),
  query("studyAbroad", "string", "1: offers study abroad."),
  query("noEssay", "string", "1: an application essay is not required."),
  query("gpaRequired", "string", "1: a high school GPA is required."),
  query("byRes", "string", "1: publishes admit rates by residency (in-state, out-of-state)."),
  query("oosEven", "string", "1: admits out-of-state applicants about as often as in-state ones."),
  query("gpa", "string", "1: publishes first-years' GPA."),
  query("aidForms", "string", "no-css: no CSS Profile required.", { enum: ["no-css"] }),
  query("intlAid", "string", "1: offers financial aid to international students."),
  query("honors", "string", "1: has an honors program."),
  query("transfers", "string", "1: admits transfer students."),
  query("minGreek", "number", "At least this percent of undergraduate men or women in fraternities or sororities (20 means 20%)."),
  query("gapYear", "string", "1: allows deferred admission (a gap year)."),
  query("faith", "string", "Comma-separated faith families (catholic, baptist, methodist, lutheran, presbyterian_reformed, nondenominational, other_christian, jewish, latter_day_saint, other), or none for no affiliation."),
  query("faithGroup", "string", "Comma-separated traditions with a listed community on campus (jewish, catholic, muslim, hindu, buddhist, and others)."),
  query("lgbtqCenter", "string", "1: has a listed LGBTQ+ center."),
  query("lgbtqHousing", "string", "1: offers gender-inclusive housing."),
  query("lgbtqNondiscrimination", "string", "1: nondiscrimination policy covers gender identity."),
  query("greekCouncils", "string", "Comma-separated Greek councils with a listed chapter (nphc, nalfo, napa, nmgc, lgbtq, professional; npc and nic are not filters)."),
  query("near", "string", "A five-digit ZIP code: keeps colleges within `within` miles of its center and enables sort=distance."),
  query("within", "integer", "With near: the radius in miles (25, 50, 100, 200, 300, or 500; default 100)."),
  query("minAidIncome", "integer", "Need-based aid reaches families earning at least this many dollars (an estimate; applies only where the site shows estimates)."),
  query("merit", "string", "1: offers merit aid."),
  query("income", "integer", "A family income in dollars: prices sort=price_at at it."),
];

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
  {
    id: "schools.list",
    method: "GET",
    path: `${API_BASE}/schools`,
    summary: "Search and list colleges",
    description:
      "Colleges matching Explore's filters, in Explore's order, a page at a time. Every filter Explore's address bar uses works here by the same name, so an Explore URL's query string can be pasted onto this path. Each item is the full record the site renders (less Quad's internal fields); fields= trims it. Parameters this endpoint doesn't know are refused, so a typo can't quietly return every college.",
    params: [
      ...SCHOOL_LIST_PARAMS,
      query("sort", "string", "What to sort by (Explore's sort keys; sortBy is accepted too). Colleges missing the value sort last. Default applicants.", {
        enum: ["applicants", "bachelors", "completion_8yr", "completion_4yr", "student_faculty", "instruction_spending", "endowment_per_student", "name", "acceptance_rate", "enrollment", "sat", "pell", "first_gen", "diversity", "avg_cost", "aid_generosity", "net_price", "earnings", "grad_rate", "avg_cost_change", "admit_rate_change", "size_change", "apps_change", "diversity_change", "men_share", "part_time", "men_share_change", "admit_gap", "loan_rate", "loan_rate_change", "pell_gap", "pell_gap_change", "full_time_faculty", "out_of_state", "transfer_share", "selectivity", "distance", "price_at"],
      }),
      query("sortDir", "string", "asc or desc. Default: desc for applicants, asc for everything else.", { enum: ["asc", "desc"] }),
      query("limit", "integer", "Colleges per page, 1 to 100 (default 50; a larger number is held to 100)."),
      query("cursor", "string", "The next_cursor from the previous page, unchanged. Opaque."),
      fieldsParam("top-level keys of the record (unit_id and name are always kept)"),
    ],
    keyed: true,
  },
  {
    id: "schools.get",
    method: "GET",
    path: `${API_BASE}/schools/{id}`,
    summary: "One college",
    description: "The college's record as the site renders it, less Quad's internal fields. 404 for an unknown id.",
    params: [idParam, fieldsParam("top-level keys of the record (unit_id and name are always kept)")],
    keyed: true,
  },
  {
    id: "schools.history",
    method: "GET",
    path: `${API_BASE}/schools/{id}/history`,
    summary: "A college's year-by-year history",
    description:
      "The college's history shard (applicants, admit rate, prices, enrollment, and more, year by year) with the definition of each series it holds: label, unit, whether years are fall terms, academic years, or entering cohorts, and any break in comparability. 404 when the college has no history.",
    params: [idParam],
    keyed: true,
  },
  {
    id: "schools.lineage",
    method: "GET",
    path: `${API_BASE}/schools/{id}/lineage`,
    summary: "Where each value came from",
    description:
      "For every registered field the college has a value for: the source, the year the value describes, and how it was made (the formula and inputs for calculated values, the quote for college-reported ones). The same records the site cites.",
    params: [idParam, fieldsParam("field paths or prefixes (admissions, cost.tuition_fees)")],
    keyed: true,
  },
  {
    id: "schools.changes",
    method: "GET",
    path: `${API_BASE}/schools/{id}/changes`,
    summary: "Recent changes to a college's data",
    description:
      "The changes recorded for the college when the dataset was last published, newest first, each with the sentence the site shows. An empty list when nothing is recorded or the change log can't be read.",
    params: [idParam],
    keyed: true,
  },
  {
    id: "national",
    method: "GET",
    path: `${API_BASE}/national`,
    summary: "National figures",
    description:
      "For each metric the site compares colleges on: the national median, how many colleges report it, and its distribution; plus the national history (year-by-year distributions across colleges). What \"typical\" lines and percentiles use.",
    params: [],
    keyed: true,
  },
];

/**
 * The MCP server's tools (lib/api/mcp.ts registers them; tests/api-mcp.test.mts checks the names and inputs match).
 * An MCP input has no place in a URL, so every `in` is "query"; a list input is typed by its items and says "list".
 */
export const MCP_TOOLS: readonly McpToolDoc[] = [
  {
    name: "search_colleges",
    summary: "Find colleges by name, nickname, or place and Explore's filters; each row has the unit_id, name, city, state, kind, and acceptance rate.",
    inputs: [
      { name: "query", in: "query", type: "string", description: "A college's name, short name or nickname (\"UGA\"), city, or state." },
      { name: "states", in: "query", type: "string", description: "A list of two-letter state codes, e.g. [\"CA\", \"NY\"]." },
      { name: "types", in: "query", type: "string", description: "A list of kinds of college.", enum: ["public", "private-nonprofit", "private-forprofit"] },
      { name: "sizes", in: "query", type: "string", description: "A list of undergraduate enrollment sizes.", enum: ["small", "medium", "large", "xl"] },
      { name: "min_admit_rate", in: "query", type: "number", description: "Lowest acceptance rate, in percent." },
      { name: "max_admit_rate", in: "query", type: "number", description: "Highest acceptance rate, in percent." },
      { name: "min_sat", in: "query", type: "integer", description: "Middle-50% SAT range reaches at least this total." },
      { name: "max_sat", in: "query", type: "integer", description: "Middle-50% SAT range starts at or below this total." },
      { name: "min_act", in: "query", type: "integer", description: "Middle-50% ACT range reaches at least this composite." },
      { name: "max_act", in: "query", type: "integer", description: "Middle-50% ACT range starts at or below this composite." },
      { name: "limit", in: "query", type: "integer", description: "How many colleges to return (default 10, at most 50)." },
    ],
  },
  {
    name: "get_college",
    summary: "One college's full record, by unit_id or by name; a name several colleges share returns the candidates instead.",
    inputs: [
      { name: "unit_id", in: "query", type: "string", description: "The college's IPEDS unit_id (give this or name)." },
      { name: "name", in: "query", type: "string", description: "The college's name or a short name, resolved the way search ranks them." },
      { name: "fields", in: "query", type: "string", description: "A list of top-level keys to return; unit_id and name always come back." },
    ],
  },
  {
    name: "compare_colleges",
    summary: "2 to 10 colleges metric by metric: each value with its percentile rank, the national median, and each value's lineage.",
    inputs: [
      { name: "unit_ids", in: "query", type: "string", description: "A list of 2 to 10 unit_ids.", required: true },
      { name: "metrics", in: "query", type: "string", description: "A list of metric keys (default: every public metric)." },
    ],
  },
  {
    name: "get_history",
    summary: "A college's year-by-year series with their definitions, breaks, and the federal files behind them.",
    inputs: [
      { name: "unit_id", in: "query", type: "string", description: "The college's IPEDS unit_id.", required: true },
      { name: "series", in: "query", type: "string", description: "A list of series keys (default: every series the college has)." },
    ],
  },
  {
    name: "get_lineage",
    summary: "The resolved source, year, method, formula, and quote behind each of a college's values.",
    inputs: [
      { name: "unit_id", in: "query", type: "string", description: "The college's IPEDS unit_id.", required: true },
      { name: "fields", in: "query", type: "string", description: "A list of field paths or prefixes to narrow to." },
    ],
  },
  {
    name: "list_fields",
    summary: "The public field registry: path, label, topic, default source and year, and formulas for calculated values.",
    inputs: [{ name: "topic", in: "query", type: "string", description: "Only fields of this topic (e.g. admissions, prices, outcomes)." }],
  },
  {
    name: "get_dataset_info",
    summary: "When the dataset was retrieved, its sources and release years, the release calendar, and counts (what /meta returns).",
    inputs: [],
  },
  {
    name: "search",
    summary: "Find colleges by name or nickname and get ids for fetch: the shape ChatGPT's deep research expects.",
    inputs: [{ name: "query", in: "query", type: "string", description: "A college's name, nickname, or part of one.", required: true }],
  },
  {
    name: "fetch",
    summary: "One college as a document for ChatGPT's deep research: its public values as lines with a source and year each, and its Quad page.",
    inputs: [{ name: "id", in: "query", type: "string", description: "The college's unit_id, from search.", required: true }],
  },
  {
    name: "glossary",
    summary: "What a term on Quad means (acceptance rate, net price, test-optional, and the rest), with related terms.",
    inputs: [{ name: "term", in: "query", type: "string", description: "A glossary key (acceptance-rate) or part of a term; without it, every public term." }],
  },
];

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
