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
  | "unreachable";

export interface CheckFailure {
  check: CheckId;
  detail: string;
}

/** One item for a person to look at. Resolving it = fix the recipe or add an override, then re-run. */
export interface ReviewItem {
  unit_id: string;
  name: string;
  /** Which document(s) the values came from. */
  urls: string[];
  entering_term: string | null;
  extraction: Extraction;
  failures: CheckFailure[];
  queued: string;
  run: string;
}

export interface ReviewQueueFile {
  updated: string;
  items: ReviewItem[];
}

/* ------------------------------------------------------------------ */
/* Runs: the circuit breaker and cost log                              */
/* ------------------------------------------------------------------ */

/** Limits past which a run's output is a pipeline problem, not data: the PR must not auto-merge. */
export const CIRCUIT_BREAKER = {
  /** Share of attempted colleges that failed checks. */
  maxFailureShare: 0.1,
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
  usage: Record<keyof typeof REPORTED_MODELS, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>;
}

/** "Fall 2026" → 2026; null for anything else. */
export function fallYear(term: string | null | undefined): number | null {
  const m = /^Fall (\d{4})$/.exec(term?.trim() ?? "");
  return m ? Number(m[1]) : null;
}
