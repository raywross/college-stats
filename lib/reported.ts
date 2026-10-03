/**
 * College-reported data: the shapes of the ingestion agent's files and the rules shared by the pipeline
 * (scripts/sync-college-reported.mts), the sync (which merges the published values into `school.reported`), the
 * app, and the tests. Pure module: type-only imports, no runtime dependencies. See specs/college-reported-data.md.
 *
 * Files (all in data/, committed, one entry per line where they're large):
 *   college-sources.json   recipes: where each college publishes, with document hashes so unchanged files are skipped
 *   college-reported.json  values that passed every check (what the sync merges into school.reported)
 *   review-queue.json      values that failed a check, with the reason, for a person to look at
 *   reports/               per-run summaries and accuracy reports
 */
import type { LineageRecord, ReportedAdmissions, ReportedSourceKind, SourceInfo } from "./types";
import type { CallKey, DocumentType } from "./cds-sections";

/** `meta.sources["college-site"]`, written by the sync; the app's placeholder when a publish is mid-flight. */
export const COLLEGE_SITE_SOURCE: SourceInfo = {
  label: "College website (class profile or Common Data Set)",
  publisher: "Each college",
  edition: "Newest figures each college has published; the year is shown with each value",
  url: "/data#college-reported",
  description:
    "Figures a college posted itself, usually a year ahead of federal data: its newest class profile or Common Data Set. Read automatically from the college's site, checked against its own math and the federal baseline, and shown only on that college's profile with the exact quote and link.",
};

/* ------------------------------------------------------------------ */
/* Models (one place, so the pilot can change them)                    */
/* ------------------------------------------------------------------ */

/**
 * Which Claude model does which job; decided in the spec (2026-09-28), revised after the pilot
 * (specs/college-reported-round-2.md: Opus is no longer called).
 */
export const REPORTED_MODELS = {
  /** Learns a college's format once: finds the CDS and class-profile links with web search (links only, no reading). */
  discovery: "claude-sonnet-5",
  /** Reads a known document into the fixed schema; the cheapest model that passes the pilot. */
  extraction: "claude-haiku-4-5",
  /** The stronger extractor: one re-read of the same document when its figures failed a check, before the review queue. */
  escalation: "claude-sonnet-5",
} as const;

/** The extractor's section anchors when a recipe source has none (discovery returns links only since round 2). */
export const DEFAULT_ANCHORS: Record<ReportedSourceKind, string> = { cds: "C1", "class-profile": "appl" };

/* ------------------------------------------------------------------ */
/* Recipes: data/college-sources.json                                  */
/* ------------------------------------------------------------------ */

export type DocumentFormat = "pdf" | "html" | "xlsx";

/** One document a college publishes, as discovery found it, with what we know about the copy we last read. */
export interface RecipeSource {
  kind: ReportedSourceKind;
  url: string;
  format: DocumentFormat;
  /**
   * PDF pages (1-based) that hold the admissions section; the extractor sends these plus the anchor's pages. Discovery
   * no longer sets it (round 2); kept for recipes written before and for hand-fixed recipes.
   */
  pages?: number[];
  /**
   * Text that marks the right section; its absence means the format changed. Discovery no longer sets it (round 2):
   * without one the extractor uses DEFAULT_ANCHORS ("C1" for a CDS, "appl" for a class profile).
   */
  anchor?: string;
  /** Conditional-GET state and the content hash of the copy last processed; absent until first read. */
  etag?: string;
  last_modified?: string;
  sha256?: string;
  /** ISO date the model last read this document (not the last time it was checked for changes). */
  processed?: string;
  /** The last extraction from this document, kept so a re-run can re-check without re-reading. */
  extraction?: Extraction | null;
}

/** Where one college publishes its newer figures. Written by discovery; `sources` updated by every run. */
export interface Recipe {
  unit_id: string;
  sources: RecipeSource[];
  /** Pages re-checked cheaply for new links (a college's CDS listing); a new link triggers extraction of that file. */
  index_urls: string[];
  /** ISO date discovery ran, and the model that ran it ("guessed": next year's CDS URL was guessed, no model call). */
  learned: string;
  model: string;
  /** Discovery found nothing newer than federal data; re-tried on the next scheduled discovery, not every run. */
  none_found?: true;
  /** Free text from discovery: what the college publishes and where (helps a person fix the recipe). */
  notes?: string;
  /** How the round-3 discovery ladder found this recipe, what it tried, and when to try again (Decisions 6–7). */
  discovery?: RecipeDiscovery;
}

/**
 * How a recipe was found (specs/college-reported-round-3.md Decision 6): `known` an index page re-scan, `guessed` the
 * next edition's file name, `manual` the owner's list (data/reference/cds-urls.json), `probe-*` the free probes
 * (sitemap, IR host pattern, two-hop crawl), `picker`/`search`/`full` the paid steps 2–4, `blocked` every candidate
 * host refuses us (listed for the owner, no money spent), `none` nothing found.
 */
export type DiscoveryPath =
  | "known"
  | "guessed"
  | "manual"
  | "probe-sitemap"
  | "probe-host"
  | "probe-crawl"
  | "picker"
  | "search"
  | "full"
  | "blocked"
  | "none";

/** One rung of the ladder tried for a college: 0 known, 1 free probes, 2 picker, 3 search only, 4 full, 5 manual. */
export interface DiscoveryAttempt {
  step: 0 | 1 | 2 | 3 | 4 | 5;
  /** The sub-step for step 1 (sitemap, host, crawl) and the path a find took. */
  via?: DiscoveryPath;
  /** ISO date. */
  at: string;
  result: "found" | "none" | "failed" | "blocked" | "skipped";
  /** What was found or why not: a URL, an error, "budget spent". */
  detail?: string;
  cost_usd: number;
}

export interface RecipeDiscovery {
  path: DiscoveryPath;
  /** Every attempt, oldest first; the newest 20 are kept. */
  tried: DiscoveryAttempt[];
  /** ISO date before which the ladder isn't run again (Decision 7 back-off); absent = retry on the next run. */
  next_attempt?: string;
}

export interface SourcesFile {
  /** ISO date of the last run that touched this file. */
  updated: string;
  recipes: Recipe[];
}

/* ------------------------------------------------------------------ */
/* Extraction: the model's fixed output schema (phase 1: admissions)   */
/* ------------------------------------------------------------------ */

export type Cohort = "first-year" | "transfer" | "unknown";
export type Scope = "all-rounds" | "early-only" | "regular-only" | "unknown";

/** What the extraction model returns for one document (structured output; every field required, nulls allowed). */
export interface Extraction {
  cohort: Cohort;
  scope: Scope;
  /** "Fall 2026"; null when the document doesn't say which class it describes. */
  entering_term: string | null;
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
  /** As stated, as a fraction (0.04 for "4.0%"); null when not stated. */
  acceptance_rate: number | null;
  /** Verbatim text each number came from; a number without a quote is never published. */
  quotes: { applicants?: string; admitted?: string; enrolled?: string; acceptance_rate?: string };
  /** PDF page the figures are on, 1-based. */
  page?: number | null;
}

/** JSON Schema for `Extraction`, sent as the structured-output format. Keep in step with the interface. */
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cohort", "scope", "entering_term", "applicants", "admitted", "enrolled", "acceptance_rate", "quotes", "page"],
  properties: {
    cohort: { type: "string", enum: ["first-year", "transfer", "unknown"] },
    scope: { type: "string", enum: ["all-rounds", "early-only", "regular-only", "unknown"] },
    entering_term: { type: ["string", "null"], description: 'The fall the class entered, as "Fall YYYY"' },
    applicants: { type: ["integer", "null"] },
    admitted: { type: ["integer", "null"] },
    enrolled: { type: ["integer", "null"] },
    acceptance_rate: { type: ["number", "null"], description: "As stated in the document, as a fraction between 0 and 1" },
    quotes: {
      type: "object",
      additionalProperties: false,
      properties: {
        applicants: { type: "string" },
        admitted: { type: "string" },
        enrolled: { type: "string" },
        acceptance_rate: { type: "string" },
      },
    },
    page: { type: ["integer", "null"] },
  },
} as const;

/* ------------------------------------------------------------------ */
/* Published values: data/college-reported.json                        */
/* ------------------------------------------------------------------ */

/**
 * Every path the pipeline publishes, keyed as in `school.lineage`: the four figures plus the block's own metadata
 * (entering_term, year, source_kind), each registered in lib/fields.ts and each needing its own `extracted` record
 * (lib/lineage.ts validateSchool).
 */
export type ReportedValuePath =
  | "reported.admissions.entering_term"
  | "reported.admissions.year"
  | "reported.admissions.applicants"
  | "reported.admissions.admitted"
  | "reported.admissions.enrolled"
  | "reported.admissions.acceptance_rate"
  | "reported.admissions.source_kind";

/** One college's published values, ready for the sync to merge: the block plus a lineage record per value. */
export interface ReportedEntry {
  unit_id: string;
  admissions: ReportedAdmissions;
  /** `extracted` records (source "college-site", with quote, url, retrieved, year, page) for each non-null value. */
  lineage: Partial<Record<ReportedValuePath, LineageRecord>>;
  /** Which run published this, for the circuit breaker and reports. */
  run: string;
}

export interface ReportedFile {
  /** ISO date of the last run that published anything; null before the pipeline has ever run. */
  updated: string | null;
  entries: ReportedEntry[];
}

/* ------------------------------------------------------------------ */
/* Checks and the review queue: data/review-queue.json                 */
/* ------------------------------------------------------------------ */

/** The automated checks, numbered as in the spec. All must pass for a value to publish. */
export type CheckId =
  | "cohort-and-scope" // 1. first-year, all rounds
  | "quote-present" // 2. every number has a quote that contains it
  | "funnel-order" // 3. admitted ≤ applicants, enrolled ≤ admitted
  | "rate-matches" // 4. stated rate = admitted ÷ applicants within 0.1 pt
  | "newer-than-federal" // 5. entering term newer than the federal admissions year
  | "plausible-change" // 6. applicants ×0.5–×2, admit rate ±15 pts (±50% relative under 10%) vs federal
  | "sources-agree" // 7. two documents for the same term agree within 1%
  // Not a check on figures: every source of the college failed to fetch (robots.txt, 401/403/405/429, 404, network
  // error). No model can fix that, so it is queued without a model call and not counted in `failed`.
  | "unreachable"
  // Round 3 (specs/college-reported-round-3.md Decision 9; lib/cds-checks.ts): checks on every record item.
  // Universal checks, on every value:
  | "type-range" // the value fits its type: counts whole and ≥ 0, shares 0–100%, GPA 0–5, SAT/ACT ranges, months, days
  | "number-on-line" // model reads: the value (number, mark, or words) appears on its cited line(s)
  | "line-in-document" // model reads: every cited line id exists in the archived line text
  | "edition-mismatch" // the edition (cover) or the year an item's own text names matches the edition it's filed under
  | "form-vs-code" // template workbooks: the visible form and the code table hold the same value
  | "overflow-total" // reader: a total printed "##" (Excel overflow) whose parts can't be summed
  | "aid-year" // reader: H.101 names no aid year ("2023"), so H1, H2, H2A and H6 have no year
  // Per-item checks (the scope table's Checks column, refined by the nine cds-*.md specs):
  | "parts-sum" // parts add up to their printed total (±1 count, ±$1K in H1, ±1 unit in C5); H5's union bound
  | "sums-to-100" // a percent column (C9 bands, C11 GPA bands, J) sums to 100% ±1 point
  | "order" // a ≤ b: funnels, percentiles, class-rank bands, H2 lines, wait list, ED counts, H5 rows
  | "ratio-matches" // a stated rate, ratio, or average matches its counts (B22, B4 H, C9 share, H2 I, H6, I-2)
  | "one-mark" // exactly one mark or level per row (C7, C8, C16/C17 kind, D5, H0 methodology, H9 deadline)
  | "inconsistent" // two answers in one document contradict (C2/C21/C22 "No" with counts, C8A vs grid, D1 vs D2, H8)
  | "valid-date" // a month/day that looks numeric is a calendar date
  | "date-order" // dates in cycle order: closing ≤ notification ≤ reply; regular after early closing
  | "enrollment-disagrees" // agrees with section B of the same document (B2 vs B1, H2 line A vs B1, H4, H6 vs B2)
  | "federal-disagrees" // an implausible change against the federal value (one year older; escalated once)
  | "residency-funnel" // C1 by residency: admitted ≤ applied, enrolled ≤ admitted, per residency
  | "residency-sum" // C1 by residency: rows sum to the C1 total within 1%
  | "residency-vs-federal" // C1 by residency: enrolled shares within 10 points of IPEDS residence
  | "column-3-not-all-undergrads" // B2 column 3 total ≠ B1 total undergraduates (Illinois: non-degree only)
  | "previous-cohort-disagrees" // B5 grid (previous cohort) disagrees with IPEDS GR for the same cohort
  | "not-a-url" // G.001 isn't a URL (Cornell's "89*---31")
  | "out-of-range" // a domain range beyond the type (credits 0–200, reply weeks 1–12, aid averages ≤ cost)

export interface CheckFailure {
  check: CheckId;
  detail: string;
}

/**
 * One item for a person to look at. Resolving it = fix the recipe or add an override, then re-run.
 *
 * Round 3 keys the queue by college + edition + template code (Decision 9): a per-item entry has `code`, `edition`
 * and `sha256`, so one college can have a failing H2 and a published C1. Entries without `code` are round-1/2 C1
 * entries (a whole college's extraction) and stay valid.
 */
export interface ReviewItem {
  unit_id: string;
  name: string;
  /** Which document(s) the values came from. */
  urls: string[];
  /** C1 entries: the class the figures describe. Per-item entries: the item group's year label ("Fall 2025"). */
  entering_term: string | null;
  /** C1 entries only: the model's extraction. Per-item entries carry `code` and `value` instead. */
  extraction?: Extraction;
  failures: CheckFailure[];
  queued: string;
  run: string;
  /** Round 3: the template code that failed ("H.210"), the document's edition ("2025-26"), and its sha256. */
  code?: string;
  edition?: string;
  sha256?: string;
  /** Round 3: the item's value as read (the code table's, for a template workbook). */
  value?: number | string | boolean | null;
}

/** The review queue's key: college + edition + code. Round-1/2 entries (no code) share one key per college. */
export function reviewKey(item: Pick<ReviewItem, "unit_id" | "edition" | "code">): string {
  return `${item.unit_id}|${item.edition ?? ""}|${item.code ?? ""}`;
}

/**
 * Adds items to the queue, replacing only entries with the same key (college + edition + code). Replacing one
 * college's H2 entry leaves its C1 entry and every other code alone (Decision 9; the round-2 `enqueue` replaced every
 * item of the college).
 */
export function enqueueItems(queue: readonly ReviewItem[], items: readonly ReviewItem[]): ReviewItem[] {
  const keys = new Set(items.map(reviewKey));
  return [...queue.filter((q) => !keys.has(reviewKey(q))), ...items];
}

export interface ReviewQueueFile {
  updated: string;
  items: ReviewItem[];
}

/* ------------------------------------------------------------------ */
/* Runs: the circuit breaker and cost log                              */
/* ------------------------------------------------------------------ */

/**
 * The one limit past which a run's output looks like a pipeline problem, not data: the PR must not auto-merge.
 * Values that passed their own checks always publish; the breaker only holds a run in which many figures that were
 * already published came back different (a systematic misread). The former failure-share trigger (10% of attempted
 * colleges failing checks) was dropped 2026-10-03: it fired on blocked sites and rounding, never on a real problem.
 */
export const CIRCUIT_BREAKER = {
  /** Share of already-published values that changed in one run. */
  maxChangedShare: 0.25,
} as const;

export interface RunSummary {
  run: string;
  started: string;
  /** When the run ended; null while it's still running (the summary is rewritten after every college). */
  finished: string | null;
  /**
   * running: written mid-run, after each college. finished: every college was processed. stopped: the run ended early
   * (API budget or key problem, or cancelled); everything up to `done` is kept. Absent in summaries before 2026-10-03.
   */
  status?: "running" | "finished" | "stopped";
  /** Why a stopped run stopped. */
  stopped_reason?: string;
  /** Colleges processed so far, out of `total`. */
  done?: number;
  total?: number;
  attempted: number;
  /** Documents the model actually read (the rest were unchanged: 304 or same hash). */
  documents_read: number;
  /**
   * Colleges whose next-edition URL was guessed from a known CDS file name and confirmed with a HEAD/GET, so no
   * discovery call was needed (Decision 2, specs/college-reported-round-2.md). Optional: absent in summaries from
   * before that decision, and the PR body only shows this row when it's present.
   */
  guessed?: number;
  published: number;
  changed: number;
  /** Colleges whose figures failed a check: the circuit breaker's failure count. */
  failed: number;
  /** Colleges none of whose sources could be fetched; queued as `unreachable`, not in `failed`. Absent before round 2. */
  unreachable?: number;
  discovered: number;
  /** Colleges that got one more try: a re-discovery (unreadable document) or a stronger re-extraction (failed check). */
  escalated: number;
  /** Whether the circuit breaker tripped, and why. */
  tripped: string | null;
  /** Token usage and estimated cost by job, from each response's `usage`. */
  usage: Record<keyof typeof REPORTED_MODELS, JobUsage>;
}

/** Token usage and estimated cost of one job's calls. `input_tokens` includes cache writes and reads; the detail fields split them out. */
export interface JobUsage {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** Tokens served from the prompt cache (billed at a tenth), part of `input_tokens`. Absent in summaries before 2026-10-03. */
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /** Server web searches, billed per search on top of tokens. */
  web_searches?: number;
}

/* ------------------------------------------------------------------ */
/* Round 3 state files (specs/college-reported-round-3.md)             */
/* ------------------------------------------------------------------ */

/**
 * One Message Batches API batch a run submitted and hasn't finished collecting (Decision 5). A run that ends with
 * batches open leaves them here; the next collect picks them up within the API's 29-day window.
 */
export interface BatchEntry {
  /** The API's id, "msgbatch_…". */
  id: string;
  /** extract: the C and rest calls; escalate: Sonnet re-reads of failing calls; picker: Haiku link pickers. */
  phase: "extract" | "escalate" | "picker";
  /** ISO timestamp of submission. */
  submitted: string;
  requests: number;
  /** Worst-case cost held against `--max-cost` until results replace it with the actual cost. */
  reserved_usd: number;
  /** "u<unit_id>-<sha8>-<call>-v<version>", one per request, so results (which arrive in any order) are keyed back. */
  custom_ids: string[];
  /** The run that submitted it. */
  run: string;
  /**
   * custom_ids in this batch that are already a resubmission of an errored or expired request (Decision 5): when one
   * fails again it is queued, never resubmitted a second time. Absent when the batch holds no resubmissions.
   */
  resubmits?: string[];
  /** The model every request in this batch uses (one model per batch), for pricing collected results. */
  model?: string;
}

/** data/college-batches.json: the open batches. Empty between runs. */
export interface BatchesFile {
  /** ISO date of the last change; null before the first batch. */
  updated: string | null;
  batches: BatchEntry[];
}

/**
 * How a host refused us (Decision 8): an HTTP status, "404-to-tools" when it answers a tool user agent with 404 but a
 * browser with 200 (Texas A&M), or "challenge" for a bot-protection page (UVA's Cloudflare).
 */
export type BlockedStatus = 401 | 403 | "404-to-tools" | 405 | 429 | "challenge";

/** A host the pipeline never spends discovery money on. Blocking is per host, not per college. */
export interface BlockedHost {
  host: string;
  status: BlockedStatus;
  /** ISO dates. */
  first_seen: string;
  last_seen: string;
  /** Which colleges' candidates were on this host (for the PR body's list for the owner). */
  unit_ids?: string[];
}

/** data/reference/blocked-hosts.json, written by the pipeline. */
export interface BlockedHostsFile {
  hosts: BlockedHost[];
}

/**
 * A link the owner found by hand (Decision 8): step 0 of discovery for that college. For a blocked host, the owner
 * also downloads the file and runs `npm run archive-doc`.
 */
export interface CdsUrlEntry {
  unit_id: string;
  url: string;
  kind: ReportedSourceKind;
  note?: string;
  /** ISO date the owner added it. */
  added: string;
}

/** data/reference/cds-urls.json, the owner's manual list. */
export interface CdsUrlsFile {
  entries: CdsUrlEntry[];
}

/* ------------------------------------------------------------------ */
/* Round 3 measurement: per-call log and run summary (Decision 11)     */
/* ------------------------------------------------------------------ */

/** What a model call is for. Round 2's three jobs (REPORTED_MODELS) plus the round-3 picker, search, and vision. */
export type CallJob = "picker" | "search" | "discovery" | "extraction" | "vision" | "escalation";
export const CALL_JOBS: readonly CallJob[] = ["picker", "search", "discovery", "extraction", "vision", "escalation"];

/** Message Batches (half price, Decision 5) or a direct Messages API call. */
export type CallMode = "batch" | "interactive";

/** Which model does each round-3 job (specs/college-reported-round-3.md, Decisions 4, 6, 9). Opus is not called. */
export const ROUND3_MODELS: Record<CallJob, string> = {
  picker: "claude-haiku-4-5",
  search: "claude-sonnet-5",
  discovery: REPORTED_MODELS.discovery,
  extraction: REPORTED_MODELS.extraction,
  vision: "claude-haiku-4-5",
  escalation: REPORTED_MODELS.escalation,
};

/**
 * One model call: a line of data/reports/college-reported-calls-<run>.jsonl. Lets the reservation estimate be checked
 * against actual tokens and the console's bill be matched (batch ids make batched calls reconcilable).
 */
export interface CallLog {
  run: string;
  /** ISO timestamp the response (or batch result) was recorded. */
  at: string;
  /** The college's unit id. */
  college: string;
  job: CallJob;
  model: string;
  mode: CallMode;
  /** The document's type for extraction, vision, and escalation; null for discovery jobs. */
  document_type: DocumentType | null;
  call: CallKey | null;
  /** Batched calls: the request's custom_id and the batch id. */
  custom_id?: string;
  batch?: string;
  /** The estimate the reservation used (characters ÷ 3.5, no safety margin); null when none was made. */
  estimated_input_tokens: number | null;
  /** Every input token billed: uncached + cache writes + cache reads. */
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  /** Server web searches billed on top of tokens. */
  searches: number;
  stop_reason: string | null;
  cost_usd: number;
}

/** Decision 11's `usage[]`: one row per job × model × mode × call, summed over a run's CallLog lines. */
export interface UsageRow {
  job: CallJob;
  model: string;
  mode: CallMode;
  call?: CallKey;
  calls: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  searches: number;
  cost_usd: number;
  /** Batched rows: worst-case cost still reserved for requests not yet collected. */
  reserved_usd?: number;
}

/** Every `DiscoveryPath` (defined with the recipe types above), for summary tables. */
export const DISCOVERY_PATHS: readonly DiscoveryPath[] = [
  "known", "guessed", "manual", "probe-sitemap", "probe-host", "probe-crawl", "picker", "search", "full", "blocked", "none",
];

export interface DocumentTypeCounts {
  fetched: number;
  unchanged: number;
  archived: number;
  model_calls: number;
  split_fallback: number;
  grid_rows_undecided: number;
  vision: number;
  cost_usd: number;
}

export interface ItemCounts {
  passed: number;
  failed: number;
  blank: number;
  not_found: number;
}

/** Admit-rate tiers, as scripts/lib/college-reported/pilot.mts `tierOf` names them. */
export type ReportedTier = "very selective" | "selective" | "less selective" | "open admission";
export const REPORTED_TIERS: readonly ReportedTier[] = ["very selective", "selective", "less selective", "open admission"];

export interface TierCounts {
  colleges: number;
  located: number;
  cds_found: number;
  published_c1: number;
  cost_usd: number;
}

/** One batch the run submitted or collected. */
export interface BatchSummaryRow {
  id: string;
  requests: number;
  submitted: string;
  /** ISO timestamp the API reported `ended`; null while open. */
  ended: string | null;
  succeeded: number;
  errored: number;
  expired: number;
  reserved_usd: number;
  cost_usd: number;
}

/** What the run projects a full run would cost, printed and written before any model call (Decision 5). */
export interface CostProjection {
  full_run_usd: number;
  /** This run's own projection (before scaling a sample to the full run): what the cap guard compares. */
  run_usd?: number;
  /** How it was computed: counts × per-unit estimates, in words. */
  basis: string;
}

/**
 * The round-3 run summary (Decision 11). Extends round 2's `RunSummary` without removing anything: `usage` (by round-2
 * job) stays, and the PR-body script keeps reading it; the per-job/model/mode/call rows are `usage_rows`.
 */
export interface RunSummaryV3 extends RunSummary {
  round: 3;
  usage_rows: UsageRow[];
  discovery: Record<DiscoveryPath, { colleges: number; cost_usd: number }>;
  documents: Record<DocumentType, DocumentTypeCounts>;
  /** Per template code. */
  items: Record<string, ItemCounts>;
  tiers: Record<ReportedTier, TierCounts>;
  batches: BatchSummaryRow[];
  /** null until prepare has run. */
  projection: CostProjection | null;
}

/** "Fall 2026" → 2026; null for anything else. */
export function fallYear(term: string | null | undefined): number | null {
  const m = /^Fall (\d{4})$/.exec(term?.trim() ?? "");
  return m ? Number(m[1]) : null;
}
