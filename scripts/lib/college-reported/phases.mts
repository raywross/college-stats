/**
 * The round-3 pipeline (specs/college-reported-round-3.md Decisions 1–11): every document fetched once, archived,
 * typed from its bytes, read by code where code can (template workbooks, fillable forms), laid out and read by Haiku
 * through the Message Batches API where it can't, checked item by item, and published per item.
 *
 *   const pipeline = createRound3({ client, batches, fetch, now, archive, table });
 *   const { exit } = await pipeline.run(state, { run, phase: "all", schools, maxCost });
 *
 * `state` holds the files' contents (recipes, published C1, review queue, manifest, records, open batches, blocked
 * hosts, the owner's list, the run summary) and is updated in place; `onProgress` hands it to the CLI after every
 * college in prepare and after every collected batch, so a run that stops keeps what it finished.
 *
 * Phases (Decision 5), each resumable from the state files:
 * - prepare  (no model): ladder steps 0–1 for colleges without a working link (steps 0–1 of discovery.mts, a miss sets
 *            no back-off yet), index pages re-scanned for the rest, documents fetched only when new or changed
 *            (lib/cds-reads.ts needsFetch, conditional GET, sha256 → fetchOutcome), archived, typed (doctype.mts),
 *            template workbooks and forms read and checked at once, the rest laid out with their numbered lines
 *            archived. C1 from deterministic reads publishes at once through data/college-reported.json.
 * - discover (Haiku picker batch, Sonnet search and full discovery interactively): ladder steps 2–4 for colleges the
 *            free steps missed, within the run's money and the tier's steps; what they find is fetched as in prepare.
 * - submit   one extraction batch with every call (`C`, `rest`) a model-read document is due (callsNeedingRead), trimmed
 *            to the reservation cap in tier order; class-profile pages keep round 2's interactive extractor.
 * - collect  every ended batch: results keyed by custom_id into line-cited items, checked, published per item; failing
 *            items queued per college + edition + code; errored/expired requests resubmitted once; failing calls
 *            escalated once to Sonnet 5 as a batch.
 * - all      prepare → projection guard → discover → submit → poll and collect until the batches end or the deadline.
 * `reextract` (with `--reextract --call C|rest`) skips fetching and discovery: it re-runs deterministic readers from the
 * archive and submits the named call for every archived model-read document due it.
 *
 * Before any model call the run's projection (documents by type × per-document estimate, discovery steps × theirs) is
 * checked against the cap: over it, nothing is spent and the run ends with exit 3.
 */
import { DEFAULT_ANCHORS, REPORTED_MODELS, ROUND3_MODELS, enqueueItems, fallYear, type BatchEntry, type BatchesFile, type BlockedHostsFile, type CallLog, type CdsUrlEntry, type CheckFailure, type CostProjection, type Extraction, type Recipe, type RecipeSource, type ReportedEntry, type ReportedFile, type ReportedTier, type ReviewItem, type ReviewQueueFile, type RunSummaryV3, type SourcesFile } from "../../../lib/reported.ts";
import type { School } from "../../../lib/types";
import { CALL_KEYS, SCHEMA_VERSIONS, codesFor, normalizeValue, yearsForEdition, type CallKey, type CdsCode, type CollegeDocsFile, type CollegeRecord, type DocumentRecord, type DocumentType, type ItemResult, type ManifestEntry, type TemplateTable } from "../../../lib/cds-sections.ts";
import { compareDocuments } from "../../../lib/cds-records.ts";
import { awaitingFirstRead, callsNeedingRead, fetchOutcome, manifestEntryFor, needsFetch } from "../../../lib/cds-reads.ts";
import { citeAnswer, type NumberedLine } from "../../../lib/cds-quotes.ts";
import { applyChecks, circuitBreakerV3, dropPassed, escalationFor, failedC1Count, itemFailureShares, reviewItemsFor } from "../../../lib/cds-checks.ts";
import { runChecks, toReportedEntry } from "../../../lib/reported-checks.ts";
import { recordFromTemplate } from "../cds-xlsx.mts";
import { readFormPdf } from "./form-pdf.mts";
import { layoutDocument, type CDSplit, type EditionFound, type LineRange } from "./layout.mts";
import { typeOfDocument } from "./doctype.mts";
import { extOf } from "./archive-doc.mts";
import { priorEditionLinks, type Archive } from "./archive.mts";
import { detectFormat, findLinks, htmlToText, newSourcesFromIndex, windowAround } from "./documents.mts";
import { PoliteHttp, sha256, type FetchFn } from "./http.mts";
import { recordBlocked } from "./blocked.mts";
import { confirmDocument, freeSteps, sourcesFromPage, type Prefetched, type ProbePage, type StepFind } from "./probe.mts";
import { STEP_ESTIMATE_USD, ladder, orderColleges, retireSuperseded, shouldRetry, stepsFor, type LadderCollege, type LadderDeps, type LadderResult, type LadderState, type PaidFind } from "./discovery.mts";
import { buildEscalationRequests, buildPickerRequests, buildRequests, collect, customId, openReservations, parseCustomId, projection, projectionGuard, resubmitOnce, submit, trimToCap, type BatchApi, type BatchRequest, type Collected, type PendingDocument } from "./batch.mts";
import { discover, extract, parsePickerResponse, pickLinks, searchOnly, type CallContext, type LlmContext, type PageLink, type PickResult } from "./llm.mts";
import { callLogRow, callRecorder, emptyUsage, memoryCallLogWriter, roundUsd, summaryCost, type CallLogWriter, type ModelClient } from "./models.mts";
import { parseExtractResponse } from "./llm.mts";
import { tierOf } from "./pilot.mts";
import { fatalApiError } from "./pipeline.mts";
import { toWellFormedDeep } from "./well-formed.mts";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type Phase = "prepare" | "discover" | "submit" | "collect" | "all";
export const PHASES: readonly Phase[] = ["prepare", "discover", "submit", "collect", "all"];

/** Everything the run reads and writes, as file contents. Updated in place. */
export interface Round3State {
  sources: SourcesFile;
  reported: ReportedFile;
  queue: ReviewQueueFile;
  /** data/college-docs.json */
  manifest: CollegeDocsFile;
  /** data/cds-records/<unit_id>.json, by unit id. */
  records: Map<string, CollegeRecord>;
  /** data/college-batches.json */
  batches: BatchesFile;
  /** data/reference/blocked-hosts.json */
  blocked: BlockedHostsFile;
  /** data/reference/cds-urls.json entries (read only). */
  manual: CdsUrlEntry[];
  summary: RunSummaryV3;
  /** Unit ids whose record changed since the CLI last wrote them (the CLI clears it after writing). */
  dirty: Set<string>;
}

export interface Round3Deps {
  /** Interactive calls: discovery steps 3–4, a picker when its batch is late, class-profile extraction. */
  client: ModelClient;
  /** `new Anthropic().messages.batches`, or the fake in tests. */
  batches: BatchApi;
  fetch: FetchFn;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
  minDelayMs?: number;
  archive: Archive;
  table: TemplateTable;
  /** One line per model call (data/reports/college-reported-calls-<run>.jsonl); in memory by default. */
  callLog?: CallLogWriter;
  log?: (msg: string) => void;
  onProgress?: (state: Round3State) => void;
  /** Colleges prepared at once (requests to one host are still serialized). Default 4. */
  concurrency?: number;
  /** Between batch status checks while polling. Default 60 s. */
  pollIntervalMs?: number;
}

export interface Round3Options {
  run: string;
  phase: Phase;
  /** The colleges this run covers (federal baseline: restoreFederal already applied). */
  schools: School[];
  /** Every college, for names, tiers, and federal baselines of colleges a collected batch names. Default `schools`. */
  allSchools?: School[];
  /** Climb the ladder from step 0 for every college, ignoring stored recipes (the old recipe is kept for comparison). */
  rediscover?: boolean;
  /** Archive only: re-run deterministic readers and submit this call for every model-read document due it. */
  reextract?: CallKey;
  /** The run's dollar cap: projection guard, batch reservations, and the discovery budget. */
  maxCost: number;
  /** Most colleges sent to the paid discovery steps this run (default 100). */
  maxDiscoveries?: number;
  /** Archive the older CDS editions an index page links (owner decision 2: off). */
  archivePrior?: boolean;
  /** Stop polling open batches at this time and leave them to the collect job; null = check each once, no waiting. */
  pollUntil?: Date | null;
  /** Open-admission colleges get step 3 when money is left (owner decision 4: off, steps 0–2 only). */
  openAdmissionLeftover?: boolean;
  /** Full-run colleges ÷ this run's colleges, for the projection's full-run figure (default 1). */
  scale?: number;
}

export interface Round3Result {
  /** 0 done (batches may be left open: the draft signal), 2 breaker tripped, 3 stopped early (projection, cap, API). */
  exit: 0 | 2 | 3;
  message?: string;
}

/** The archived line text of a model-read document (archive.putLines), what quotes and re-reads use. */
export interface ArchivedLines {
  lines: string[];
  pages: number[];
  split: CDSplit | null;
  edition: EditionFound | null;
}

/** Document types read by the two model calls (lib/cds-reads.ts MODEL_TYPES; scanned PDFs are not sent yet). */
const MODEL_READ: ReadonlySet<DocumentType> = new Set(["pdf-flat", "xlsx-classic", "html"]);

/** C1 totals (applicants, admitted, enrolled): what publishes through data/college-reported.json. */
const C1_TOTALS = { applicants: "C.116", admitted: "C.117", enrolled: "C.118" } as const;

/** The longest the discover phase waits for its picker batch before asking late pickers interactively. */
const PICKER_WAIT_MS = 60 * 60 * 1000;

/** One college's interactive allowance before a paid step or a class-profile read (Decision 5's per-step check). */
const INTERACTIVE_ALLOWANCE_USD = 0.02;

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** A document's numbered lines for one call: section C, or the rest; the whole body when there is no split. */
export function callLines(arch: Pick<ArchivedLines, "lines" | "pages" | "split">, call: CallKey): NumberedLine[] {
  const all: LineRange = [1, arch.lines.length];
  const ranges: LineRange[] = !arch.split ? [all] : call === "C" ? [arch.split.C] : arch.split.rest;
  const out: NumberedLine[] = [];
  for (const [from, to] of ranges) for (let id = Math.max(1, from); id <= Math.min(to, arch.lines.length); id++) out.push({ id, page: arch.pages[id - 1] ?? 1, text: arch.lines[id - 1] });
  return out;
}

/** A model-read document's empty record: every code `not-read` until its call is read. */
export function emptyModelRecord(entry: ManifestEntry, table: TemplateTable): DocumentRecord {
  const items: Record<CdsCode, ItemResult> = {};
  for (const it of table.items) items[it.code] = { status: "not-read" };
  return {
    sha256: entry.sha256,
    edition: entry.edition!,
    type: entry.type,
    url: entry.url,
    ...(entry.final_url ? { final_url: entry.final_url } : {}),
    retrieved: entry.retrieved,
    reads: {},
    years: yearsForEdition(entry.edition!),
    items,
  };
}

/**
 * Turns one collected call into record items: values normalized by type, located and quoted from the cited lines
 * (lib/cds-quotes citeAnswer; a quote the model wrote is never used), codes the model left out `not-found`. The checks
 * (applyChecks with the archived lines) then decide `passed` or `failed`.
 */
export function itemsFromCall(
  doc: DocumentRecord,
  res: ReturnType<typeof parseExtractResponse>,
  codes: readonly CdsCode[],
  arch: Pick<ArchivedLines, "lines" | "pages">,
  table: TemplateTable,
  o: { escalation?: boolean } = {}
): DocumentRecord {
  const items = { ...doc.items };
  for (const code of codes) {
    const item = table.byCode.get(code);
    if (!item) continue;
    const got = res.values[code];
    if (!got) {
      if (!o.escalation) items[code] = { status: "not-found" };
      continue;
    }
    const n = normalizeValue(item, got.v, { percentPoints: true }); // the model reports printed percent numbers
    if (n.status === "blank") {
      items[code] = { status: "blank" };
      continue;
    }
    const r: ItemResult = { status: "passed" };
    if (n.v !== null) r.v = n.v;
    const cite = citeAnswer({ v: got.v as number | string | boolean, lines: got.lines }, arch.lines, arch.pages, { percent: item.value_type === "percent" });
    if ("citation" in cite) {
      r.line = cite.citation.line;
      if (cite.citation.lines) r.lines = cite.citation.lines;
      if (cite.citation.page !== undefined) r.page = cite.citation.page;
      r.quote = cite.citation.quote;
    } else if (got.lines.length) {
      // Located where the model said; the checks (number-on-line, line-in-document) fail it.
      r.line = got.lines[0];
      if (got.lines.length > 1) r.lines = [...got.lines];
      const page = arch.pages[got.lines[0] - 1];
      if (page !== undefined) r.page = page;
    }
    if (n.status === "overflow") {
      r.status = "failed";
      r.failures = [{ check: "overflow-total", detail: `"${got.v}" is an overflow mark` }];
    }
    items[code] = r;
  }
  return { ...doc, items };
}

/**
 * The last guard before a model-read item can publish: a `passed` value needs a page and line (or a cell or field) and,
 * for an owned item, a quote (validateCdsRecords' rules). One without is failed `line-in-document`, never published.
 */
export function failUnlocated(doc: DocumentRecord, table: TemplateTable): DocumentRecord {
  const items = { ...doc.items };
  for (const [code, it] of Object.entries(items)) {
    if (it.status !== "passed") continue;
    const located = (it.page !== undefined && (it.line !== undefined || !!it.lines?.length)) || !!it.cell || !!it.field;
    const quoted = !table.byCode.get(code)?.owner || !!it.quote;
    if (located && quoted) continue;
    items[code] = { ...it, status: "failed", failures: [...(it.failures ?? []), { check: "line-in-document", detail: located ? "no quote could be built from the cited line" : "no cited line in the document" }] };
  }
  return { ...doc, items };
}

/** A college's C1 totals from one record document, as round 2's Extraction (only items that passed their checks). */
export function c1FromDocument(doc: DocumentRecord): Extraction | null {
  const v = (code: string) => {
    const it = doc.items[code];
    return it?.status === "passed" && typeof it.v === "number" ? it : null;
  };
  const a = v(C1_TOTALS.applicants);
  const b = v(C1_TOTALS.admitted);
  const c = v(C1_TOTALS.enrolled);
  if (!a && !b && !c) return null;
  const quotes: Extraction["quotes"] = {};
  if (a?.quote) quotes.applicants = a.quote;
  if (b?.quote) quotes.admitted = b.quote;
  if (c?.quote) quotes.enrolled = c.quote;
  return {
    cohort: "first-year",
    scope: "all-rounds",
    entering_term: doc.years.fall ?? null,
    applicants: (a?.v as number | undefined) ?? null,
    admitted: (b?.v as number | undefined) ?? null,
    enrolled: (c?.v as number | undefined) ?? null,
    acceptance_rate: null,
    quotes,
    page: a?.page ?? b?.page ?? null,
  };
}

const VALUE_KEYS = ["applicants", "admitted", "enrolled", "acceptance_rate"] as const;
const countValues = (e: ReportedEntry) => VALUE_KEYS.filter((k) => e.admissions[k] !== null).length;
const hasFigures = (e: Extraction | null | undefined): e is Extraction => !!e && VALUE_KEYS.some((k) => e[k] !== null);
function changedValues(prev: ReportedEntry | undefined, next: ReportedEntry): number {
  if (!prev || prev.admissions.entering_term !== next.admissions.entering_term) return 0;
  return VALUE_KEYS.filter((k) => prev.admissions[k] !== null && prev.admissions[k] !== next.admissions[k]).length;
}

/** The manifest entry a custom_id names (unit id + the sha256's first 8 characters). */
function entryForCustomId(manifest: CollegeDocsFile, id: string): ManifestEntry | undefined {
  const p = parseCustomId(id);
  if (!p) return undefined;
  return manifest.documents.find((d) => d.unit_id === p.unit_id && d.sha256.startsWith(p.sha8));
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

export function createRound3(deps: Round3Deps) {
  const log = deps.log ?? ((m: string) => console.log(m));
  const table = deps.table;
  const http = new PoliteHttp({
    fetch: deps.fetch,
    now: () => deps.now().getTime(),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    minDelayMs: deps.minDelayMs ?? 1000,
    log,
  });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function run(state: Round3State, opts: Round3Options): Promise<Round3Result> {
    const today = deps.now().toISOString().slice(0, 10);
    const summary = state.summary;
    const all = opts.allSchools ?? opts.schools;
    const byId = new Map(all.map((s) => [s.unit_id, s]));
    for (const s of opts.schools) byId.set(s.unit_id, s);
    const recipes = new Map(state.sources.recipes.map((r) => [r.unit_id, r]));
    const entries = new Map(state.reported.entries.map((e) => [e.unit_id, e]));
    const priorValues = state.reported.entries.reduce((n, e) => n + countValues(e), 0);
    const writer = deps.callLog ?? memoryCallLogWriter();
    const record = callRecorder(summary, writer);
    /** Cost of model calls by college this run (paid discovery steps report it to the ladder). */
    const costBy = new Map<string, number>();
    const onCall = (row: CallLog) => {
      record(row);
      costBy.set(row.college, roundUsd((costBy.get(row.college) ?? 0) + row.cost_usd));
      const s = byId.get(row.college);
      if (s) {
        const t = summary.tiers[tierOf(s) as ReportedTier];
        t.cost_usd = roundUsd(t.cost_usd + row.cost_usd);
      }
    };
    /** Colleges this run read a document for or judged: the breaker's denominator. */
    const attempted = new Set<string>();
    const touchedDocs = new Map<string, DocumentRecord>();
    let stopReason: string | null = null;

    // Every interactive call goes through here: a fatal API error (key refused, spend limit) stops the run.
    async function guarded<T>(call: () => Promise<T>): Promise<T> {
      if (stopReason) throw new Error(`run stopped: ${stopReason}`);
      try {
        return await call();
      } catch (err) {
        const fatal = fatalApiError(err);
        if (fatal && !stopReason) {
          stopReason = fatal;
          log(`\nStopping: ${fatal}. Everything finished so far is kept.`);
        }
        throw err;
      }
    }
    // Well-form every string before it leaves this process: page text sliced mid-emoji (or a malformed page) can
    // carry a lone surrogate, which breaks the request body's JSON and the API rejects outright.
    const client: ModelClient = {
      messages: {
        create: (body) => guarded(() => deps.client.messages.create(toWellFormedDeep(body))),
        stream: (body, o) => ({ finalMessage: () => guarded(() => deps.client.messages.stream(toWellFormedDeep(body), o).finalMessage()) }),
      },
    };
    const api: BatchApi = {
      create: (body) => guarded(() => deps.batches.create(body)),
      retrieve: (id) => guarded(() => deps.batches.retrieve(id)),
      results: (id) => guarded(() => deps.batches.results(id)),
    };
    const callCtx: CallContext = { client, log, run: opts.run, now: deps.now, onCall };
    const spent = () => roundUsd(summaryCost(summary) + openReservations(state.batches));

    function progress() {
      summary.open_batches = state.batches.batches.length;
      state.sources = { updated: today, recipes: [...recipes.values()] };
      state.reported = { updated: summary.published ? today : state.reported.updated, entries: [...entries.values()] };
      deps.onProgress?.(state);
    }

    /* ---------------- records, manifest, queue ---------------- */

    const docsOf = (unitId: string) => state.records.get(unitId)?.documents ?? [];
    function upsertDoc(unitId: string, doc: DocumentRecord) {
      const rec = state.records.get(unitId) ?? { unit_id: unitId, documents: [] };
      rec.documents = [...rec.documents.filter((d) => d.sha256 !== doc.sha256), doc].sort(compareDocuments);
      state.records.set(unitId, rec);
      state.dirty.add(unitId);
      touchedDocs.set(doc.sha256, doc);
    }
    function upsertEntry(entry: ManifestEntry) {
      state.manifest = { updated: today, documents: [...state.manifest.documents.filter((d) => d.sha256 !== entry.sha256), entry] };
    }
    function countItems(doc: DocumentRecord, codes: Iterable<CdsCode>) {
      for (const code of codes) {
        const it = doc.items[code];
        if (!it || it.status === "not-read") continue;
        const c = (summary.items[code] ??= { passed: 0, failed: 0, blank: 0, not_found: 0 });
        if (it.status === "passed") c.passed++;
        else if (it.status === "failed") c.failed++;
        else if (it.status === "blank") c.blank++;
        else c.not_found++;
      }
    }
    function queueDoc(school: School | undefined, unitId: string, doc: DocumentRecord) {
      let items = dropPassed(state.queue.items, unitId, doc);
      items = enqueueItems(items, reviewItemsFor(doc, table, { unit_id: unitId, name: school?.name ?? unitId, run: opts.run, queued: today }));
      state.queue = { updated: today, items };
    }
    function queueOne(school: School | undefined, unitId: string, urls: string[], failures: CheckFailure[], extra: Partial<ReviewItem> = {}) {
      const item: ReviewItem = { unit_id: unitId, name: school?.name ?? unitId, urls, entering_term: null, failures, queued: today, run: opts.run, ...extra };
      state.queue = { updated: today, items: enqueueItems(state.queue.items, [item]) };
    }
    /** Checks a document against the college's federal baseline and its other documents, then stores and queues it. */
    function judgeDoc(school: School | undefined, unitId: string, doc: DocumentRecord, o: { lines?: string[]; codes?: Iterable<CdsCode> } = {}): DocumentRecord {
      const others = docsOf(unitId).filter((d) => d.sha256 !== doc.sha256);
      let checked = applyChecks(doc, { table, school: school ?? null, ...(o.lines ? { lines: o.lines } : {}), others });
      checked = failUnlocated(checked, table);
      upsertDoc(unitId, checked);
      countItems(checked, o.codes ?? Object.keys(checked.items));
      queueDoc(school, unitId, checked);
      summary.documents_read++;
      attempted.add(unitId);
      return checked;
    }

    /* ---------------- C1 publishing (round 2's file, unchanged) ---------------- */

    /**
     * Publishes the newest passing C1 for a college through data/college-reported.json (round 2's path and checks):
     * from its CDS records' passed C1 totals and from its class-profile extractions. Round 2's seven checks decide.
     */
    function publishC1(school: School) {
      const recipe = recipes.get(school.unit_id);
      const candidates: { e: Extraction; url: string; kind: "cds" | "class-profile"; retrieved: string }[] = [];
      for (const doc of docsOf(school.unit_id)) {
        const e = c1FromDocument(doc);
        if (e) candidates.push({ e, url: doc.final_url ?? doc.url, kind: "cds", retrieved: doc.retrieved });
      }
      for (const s of recipe?.sources ?? []) {
        if (s.kind === "class-profile" && hasFigures(s.extraction)) candidates.push({ e: s.extraction, url: s.url, kind: "class-profile", retrieved: s.processed ?? today });
      }
      if (!candidates.length) return;
      const extractions = candidates.map((c) => c.e);
      const judged = candidates.map((c) => ({ ...c, failures: runChecks(c.e, school, extractions) }));
      const newest = (a: (typeof judged)[number], b: (typeof judged)[number]) =>
        (fallYear(b.e.entering_term) ?? 0) - (fallYear(a.e.entering_term) ?? 0) || VALUE_KEYS.filter((k) => b.e[k] !== null).length - VALUE_KEYS.filter((k) => a.e[k] !== null).length || (a.kind === "cds" ? -1 : 1);
      const passing = judged.filter((j) => !j.failures.length).sort(newest);
      // Round 2's whole-college C1 entry (no code) is replaced or dropped; round 3's per-item entries stay.
      const c1Key = (q: ReviewItem) => q.unit_id === school.unit_id && !q.code;
      if (passing.length) {
        const best = passing[0];
        const entry = toReportedEntry(best.e, school, { url: best.url, kind: best.kind, retrieved: best.retrieved, page: best.e.page }, opts.run);
        state.queue = { updated: today, items: state.queue.items.filter((q) => !c1Key(q)) };
        const prev = entries.get(school.unit_id);
        if (prev && JSON.stringify(prev.admissions) === JSON.stringify(entry.admissions)) return;
        summary.changed += changedValues(prev, entry);
        summary.published++;
        summary.tiers[tierOf(school) as ReportedTier].published_c1++;
        entries.set(school.unit_id, entry);
        log(`${school.name}: published C1 ${entry.admissions.entering_term} (${entry.admissions.source_kind}): ${entry.admissions.applicants ?? "–"} applied, ${entry.admissions.admitted ?? "–"} admitted`);
        return;
      }
      const real = judged.filter((j) => !j.failures.every((f) => f.check === "newer-than-federal")).sort(newest);
      if (!real.length) return;
      summary.failed++;
      queueOne(school, school.unit_id, [real[0].url], real[0].failures, { entering_term: real[0].e.entering_term, extraction: real[0].e });
    }

    /* ---------------- fetch, archive, type, read ---------------- */

    /** Reads a document's archived lines, laying it out again from the archived bytes when the sidecar is missing. */
    async function loadLines(entry: ManifestEntry): Promise<ArchivedLines | null> {
      const got = await deps.archive.getLines<ArchivedLines>(entry.sha256);
      if (got) return got;
      const bytes = await deps.archive.get(entry.sha256);
      if (!bytes) return null;
      const lay = await layoutDocument(bytes, entry.type);
      const arch: ArchivedLines = { lines: lay.lines, pages: lay.pages, split: lay.split, edition: lay.edition };
      await deps.archive.putLines(entry.sha256, arch);
      return arch;
    }

    /** A deterministic read (template workbook or form) from bytes: record → checks → stored, queued, C1 published. */
    async function readDeterministic(school: School | undefined, entry: ManifestEntry, bytes: Uint8Array, book?: import("../cds-xlsx.mts").Workbook): Promise<DocumentRecord> {
      const base = { unit_id: entry.unit_id, url: entry.url, sha256: entry.sha256, retrieved: entry.retrieved, table, ...(entry.final_url ? { final_url: entry.final_url } : {}) };
      let doc: DocumentRecord;
      if (entry.type === "xlsx-template") {
        const wb = book ?? (await typeOfDocument(bytes)).book;
        if (!wb) throw new Error(`${entry.url}: not a workbook`);
        doc = recordFromTemplate(wb, base);
      } else {
        doc = await readFormPdf(bytes, { ...base, ...(entry.edition ? { edition: entry.edition } : {}) });
      }
      return judgeDoc(school, entry.unit_id, doc);
    }

    type SourceRead = { state: "unchanged" } | { state: "read"; entry: ManifestEntry } | { state: "unreachable"; detail: string } | { state: "problem"; detail: string };

    /** Whether a manifest document has never been read (lib/cds-reads.ts awaitingFirstRead): its record by sha256, or this source's extraction. */
    const unread = (entry: ManifestEntry, src: RecipeSource) => awaitingFirstRead(entry, docsOf(entry.unit_id).find((d) => d.sha256 === entry.sha256), src);

    /**
     * A known document that was archived but never read (a run stopped between prepare and submit, say): read now from
     * these bytes, as a new document would be. Template workbooks and forms are read by code; a model-read document's
     * lines are archived for the submit phase; a class profile is left for round 2's extractor. Bytes that came from a
     * fetch are archived again first, so the submit and collect phases find them.
     */
    async function readKnown(school: School, src: RecipeSource, entry: ManifestEntry, bytes: Uint8Array, fetched: boolean): Promise<SourceRead> {
      try {
        src.sha256 = entry.sha256;
        if (fetched) {
          const location = await deps.archive.put(entry.sha256, bytes, extOf(entry.type));
          summary.documents[entry.type].fetched++;
          summary.documents[entry.type].archived++;
          if (location !== entry.archive) upsertEntry({ ...entry, archive: location });
        }
        const current = state.manifest.documents.find((d) => d.sha256 === entry.sha256) ?? entry;
        if (current.type === "xlsx-template" || current.type === "pdf-form") {
          const doc = await readDeterministic(school, current, bytes);
          log(`  ${school.name}: ${current.type} ${doc.edition} archived earlier but never read; read by code now`);
        } else if (current.type === "class-profile") {
          src.extraction = undefined;
          delete src.processed;
          log(`  ${school.name}: class profile archived earlier but never read; waiting for the extractor`);
        } else {
          if (!(await loadLines(current))) throw new Error(`${current.sha256.slice(0, 8)}: no lines`);
          log(`  ${school.name}: ${current.type} ${current.edition} archived earlier but never read; waiting for the extraction batch`);
        }
        attempted.add(school.unit_id);
        return { state: "read", entry: current };
      } catch (err) {
        return { state: "problem", detail: `${src.url}: ${errText(err)}` };
      }
    }

    /**
     * One source: fetch only when new or changed, then archive, type, and read what code can read. A known document
     * counts as unchanged only once it has been read; one that never was is read from the archive, or fetched again
     * when the archive doesn't hold its bytes.
     */
    async function acquireSource(school: School, src: RecipeSource, o: { prefetched: Map<string, Prefetched>; indexChanged: boolean }): Promise<SourceRead> {
      const known = state.manifest.documents.filter((d) => d.url === src.url || d.final_url === src.url).sort((a, b) => b.retrieved.localeCompare(a.retrieved))[0];
      let bytes: Uint8Array;
      let finalUrl = src.url;
      const pre = o.prefetched.get(src.url);
      if (pre) {
        bytes = pre.bytes;
        o.prefetched.delete(src.url);
        src.checked = today;
      } else {
        const pending = !!known && unread(known, src);
        if (pending) {
          const stored = await deps.archive.get(known.sha256);
          if (stored) return readKnown(school, src, known, stored, false);
        }
        // Never read and not in the archive: fetch it in full (a conditional GET could answer 304 with no bytes).
        const d: { fetch: boolean; conditional?: { etag?: string; last_modified?: string } } = pending ? { fetch: true, conditional: {} } : needsFetch(known, { etag: src.etag, last_modified: src.last_modified, lastChecked: src.checked ?? null, today, indexChanged: o.indexChanged });
        if (!d.fetch) {
          if (known) summary.documents[known.type].unchanged++;
          return { state: "unchanged" };
        }
        let res: Response | null;
        try {
          // A CDS file is fetched even where robots.txt disallows it (owner decision 2026-10-10); class profiles aren't.
          res = await http.get(src.url, d.conditional, {}, { cdsDocument: src.kind === "cds" });
        } catch (err) {
          return { state: "unreachable", detail: `${src.url}: ${errText(err)}` };
        }
        if (!res) return { state: "unreachable", detail: `robots.txt disallows ${src.url}` };
        src.checked = today;
        if (res.status === 304) {
          if (known) summary.documents[known.type].unchanged++;
          return { state: "unchanged" };
        }
        if (!res.ok) return { state: "unreachable", detail: `HTTP ${res.status} at ${src.url}` };
        bytes = new Uint8Array(await res.arrayBuffer());
        finalUrl = res.url || src.url;
        const etag = res.headers.get("etag");
        const lm = res.headers.get("last-modified");
        if (etag) src.etag = etag;
        else delete src.etag;
        if (lm) src.last_modified = lm;
        else delete src.last_modified;
      }
      const sha = sha256(bytes);
      src.sha256 = sha;
      if (fetchOutcome(state.manifest, { status: 200, sha256: sha }) === "unchanged") {
        const was = state.manifest.documents.find((d) => d.sha256 === sha)!;
        if (unread(was, src)) return readKnown(school, src, was, bytes, true);
        summary.documents[was.type].unchanged++;
        return { state: "unchanged" };
      }
      // A new document: archive it before anything reads it, so no later read ever needs the college's site.
      try {
        src.format = detectFormat(bytes, null, src.url);
        const typed = src.kind === "class-profile" ? { type: "class-profile" as const } : await typeOfDocument(bytes);
        const type: DocumentType = typed.type;
        const location = await deps.archive.put(sha, bytes, extOf(type));
        const counts = summary.documents[type];
        counts.fetched++;
        counts.archived++;
        const base = { sha256: sha, unit_id: school.unit_id, url: src.url, final_url: finalUrl, kind: src.kind, type, retrieved: today, bytes: bytes.length, archive: location };
        if (type === "xlsx-template" || type === "pdf-form") {
          // The edition comes from the reader (the workbook's own cells, or the form's cover).
          const provisional = manifestEntryFor({ ...base, edition: null, ...("pdf" in typed && typed.pdf ? { pages: typed.pdf.pages } : {}) });
          const doc = await readDeterministic(school, provisional, bytes, "book" in typed ? typed.book : undefined);
          upsertEntry(manifestEntryFor({ ...base, edition: doc.edition, edition_from: type === "xlsx-template" ? "workbook" : "cover", ...("pdf" in typed && typed.pdf ? { pages: typed.pdf.pages } : {}) }));
          log(`  ${school.name}: ${type} ${doc.edition} read by code (${Object.values(doc.items).filter((i) => i.status === "passed").length} passed)`);
        } else if (type === "class-profile") {
          upsertEntry(manifestEntryFor({ ...base, edition: null }));
          // Round 2's extractor reads it in the submit phase.
          src.extraction = undefined;
          delete src.processed;
        } else {
          const lay = await layoutDocument(bytes, type);
          const arch: ArchivedLines = { lines: lay.lines, pages: lay.pages, split: lay.split, edition: lay.edition };
          if (type !== "pdf-scanned") await deps.archive.putLines(sha, arch);
          if (lay.split?.fallback) counts.split_fallback++;
          upsertEntry(
            manifestEntryFor({
              ...base,
              edition: lay.edition?.edition ?? null,
              ...(lay.edition ? { edition_from: lay.edition.from } : {}),
              pages: lay.pageCount || null,
              body_chars: lay.bodyChars,
              definitions_from_page: lay.definitionsFrom,
              sections: lay.sections,
            })
          );
          if (type === "pdf-scanned") log(`  ${school.name}: scanned PDF archived; whole-document reads aren't wired yet (none in the sample)`);
          else if (!lay.edition) log(`  ${school.name}: ${type} archived, but it states no edition; not sent to a model`);
          else log(`  ${school.name}: ${type} ${lay.edition.edition} archived and laid out (${lay.lines.length} lines${lay.split?.fallback ? ", no C/D split" : ""}); waiting for the extraction batch`);
        }
        attempted.add(school.unit_id);
        return { state: "read", entry: state.manifest.documents.find((d) => d.sha256 === sha)! };
      } catch (err) {
        return { state: "problem", detail: `${src.url}: ${errText(err)}` };
      }
    }

    /** Archives the older editions an index page links (`--archive-prior`); nothing reads them now. */
    async function archivePrior(school: School, html: string, indexUrl: string) {
      const newest = docsOf(school.unit_id)[0]?.edition ?? state.manifest.documents.filter((d) => d.unit_id === school.unit_id && d.edition).map((d) => d.edition!).sort().pop();
      if (!newest) return;
      for (const link of priorEditionLinks(findLinks(html, indexUrl), newest)) {
        if (state.manifest.documents.some((d) => d.url === link.url)) continue;
        try {
          const res = await http.get(link.url);
          if (!res?.ok) continue;
          const bytes = new Uint8Array(await res.arrayBuffer());
          const sha = sha256(bytes);
          if (state.manifest.documents.some((d) => d.sha256 === sha)) continue;
          const { type } = await typeOfDocument(bytes);
          const location = await deps.archive.put(sha, bytes, extOf(type));
          upsertEntry(manifestEntryFor({ sha256: sha, unit_id: school.unit_id, url: link.url, final_url: res.url || null, kind: "cds", type, edition: link.edition, retrieved: today, bytes: bytes.length, archive: location }));
          log(`  ${school.name}: archived prior edition ${link.edition} (${type})`);
        } catch (err) {
          log(`  ${school.name}: prior edition ${link.url}: ${errText(err)}`);
        }
      }
    }

    /** Every source of a recipe not fetched yet this run (test 22: never the same URL twice in one run). */
    const fetchedThisRun = new Set<string>();
    async function acquire(school: School, recipe: Recipe, o: { prefetched?: Map<string, Prefetched>; indexChanged?: boolean } = {}) {
      const reads: SourceRead[] = [];
      for (const src of recipe.sources) {
        if (fetchedThisRun.has(src.url)) continue;
        fetchedThisRun.add(src.url);
        const r = await acquireSource(school, src, { prefetched: o.prefetched ?? new Map(), indexChanged: !!o.indexChanged });
        reads.push(r);
        if (r.state === "unreachable" || r.state === "problem") log(`  ${school.name}: ${r.detail}`);
      }
      const unreachable = reads.filter((r): r is Extract<SourceRead, { state: "unreachable" }> => r.state === "unreachable");
      if (reads.length && unreachable.length === reads.length) {
        // Not a check failure: the breaker never counts it, and no model is called.
        summary.unreachable = (summary.unreachable ?? 0) + 1;
        attempted.add(school.unit_id);
        queueOne(school, school.unit_id, recipe.sources.map((s) => s.url), unreachable.map((r) => ({ check: "unreachable" as const, detail: r.detail })));
      }
      for (const r of reads) {
        if (r.state === "problem") queueOne(school, school.unit_id, recipe.sources.map((s) => s.url), [{ check: "quote-present", detail: `no figures read: ${r.detail}` }]);
      }
    }

    /* ---------------- prepare: ladder steps 0–1, fetch, deterministic reads ---------------- */

    const ladderState: LadderState = { today, budget: { remaining_usd: 0 }, blocked: state.blocked };
    /** Colleges the free steps missed, with what those steps saw (for the picker), in the order they were prepared. */
    const forPaid: LadderCollege[] = [];

    function noteLadder(school: School, r: LadderResult, final: boolean) {
      if (!r.found && !r.blockedHosts && !final) return;
      const d = summary.discovery[r.path];
      d.colleges++;
      d.cost_usd = roundUsd(d.cost_usd + r.spent_usd);
      if (r.path === "guessed") summary.guessed = (summary.guessed ?? 0) + 1;
      if (r.blockedHosts) {
        const list = (summary.blocked_colleges ??= []);
        if (!list.some((b) => b.unit_id === school.unit_id)) list.push({ unit_id: school.unit_id, name: school.name, hosts: r.blockedHosts });
      }
    }

    async function prepareCollege(school: School) {
      const tier = tierOf(school) as ReportedTier;
      summary.tiers[tier].colleges++;
      const stored = recipes.get(school.unit_id);
      let recipe = stored ? structuredClone(stored) : undefined;
      let indexChanged = false;
      let brokenIndex = false;
      if (recipe && !opts.rediscover) {
        // Index pages: re-scanned for a newer link (Decision 10). "Changed" means the set of document links changed.
        for (const idx of recipe.index_urls) {
          try {
            const res = await http.get(idx);
            if (!res) continue;
            if (res.status === 404 || res.status === 410) {
              brokenIndex = true;
              continue;
            }
            if (!res.ok) continue;
            const html = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
            const fresh = newSourcesFromIndex(html, idx, recipe.sources);
            if (fresh.length) {
              const { keep, retire } = retireSuperseded(recipe, fresh);
              for (const s of fresh) log(`  ${school.name}: new ${s.kind} link on ${idx}: ${s.url}`);
              for (const s of retire) log(`  ${school.name}: retired superseded ${s.url}`);
              recipe.sources = [...fresh, ...keep];
              indexChanged = true;
            }
            if (opts.archivePrior) await archivePrior(school, html, idx);
          } catch (err) {
            log(`  ${idx}: ${errText(err)}`);
          }
        }
      }
      let prefetched = new Map<string, Prefetched>();
      if (!recipe || opts.rediscover || shouldRetry(recipe, today, { unitId: school.unit_id, manual: state.manual, brokenIndex })) {
        const ls: LadderState = { ...ladderState, only: "free" };
        const r = await ladder({ school, recipe: opts.rediscover ? undefined : recipe }, ls, freeSteps(http, state.manual));
        ladderState.blocked = mergeBlocked(ladderState.blocked, ls.blocked);
        let next = r.recipe;
        if (opts.rediscover && stored) {
          // Keep what we knew about the documents both recipes list, and say whether the free steps found the old link.
          const old = new Map(stored.sources.map((s) => [s.url, s]));
          next = { ...next, sources: next.sources.map((s) => (old.has(s.url) ? { ...old.get(s.url)!, ...s, etag: old.get(s.url)!.etag, last_modified: old.get(s.url)!.last_modified, sha256: old.get(s.url)!.sha256, checked: old.get(s.url)!.checked, extraction: old.get(s.url)!.extraction, processed: old.get(s.url)!.processed } : s)) };
          const same = stored.sources.some((s) => s.kind === "cds" && next.sources.some((n) => n.url === s.url));
          log(`  ${school.name}: rediscovered by ${r.path}${stored.sources.some((s) => s.kind === "cds") ? (same ? " (same CDS link as the old recipe)" : " (the old recipe's CDS link was not found)") : ""}`);
          if (!r.found && !r.blockedHosts) next = { ...next, sources: next.sources.length ? next.sources : stored.sources };
        }
        recipe = next;
        prefetched = r.prefetched;
        noteLadder(school, r, false);
        if (!r.found && !r.blockedHosts) forPaid.push({ school, recipe, seed: { pages: r.pages, answered: r.answered } });
      } else {
        summary.discovery.known.colleges++;
      }
      recipes.set(school.unit_id, recipe);
      if (recipe.sources.length) summary.tiers[tier].located++;
      await acquire(school, recipe, { prefetched, indexChanged });
      noteCdsFound(school);
      publishC1(school);
    }
    /** Counts a college in its tier's `cds_found` once, when the manifest lists a CDS for it. */
    const cdsCounted = new Set<string>();
    function noteCdsFound(school: School) {
      if (cdsCounted.has(school.unit_id) || !state.manifest.documents.some((d) => d.unit_id === school.unit_id && d.kind === "cds")) return;
      cdsCounted.add(school.unit_id);
      summary.tiers[tierOf(school) as ReportedTier].cds_found++;
    }

    async function prepare(targets: School[]) {
      const queue = orderColleges(targets);
      summary.total = (summary.total ?? 0) + queue.length;
      let done = summary.done ?? 0;
      const workers = Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, async () => {
        for (let s = queue.shift(); s && !stopReason; s = queue.shift()) {
          try {
            await prepareCollege(s);
          } catch (err) {
            log(`${s.name}: ${err instanceof Error ? err.stack : err}`);
          }
          done++;
          summary.done = done;
          log(`[${done}/${summary.total}] ${s.name} prepared · run cost so far ~$${summaryCost(summary).toFixed(2)}`);
          progress();
        }
      });
      await Promise.all(workers);
      ladderState.blocked = state.blocked = recordBlocked(ladderState.blocked, http.blockedSeen(), today);
    }

    /** Re-runs deterministic readers from the archive ($0) for `--reextract`: no fetch, no discovery. */
    async function rereadDeterministic(targets: School[]) {
      const ids = new Set(targets.map((s) => s.unit_id));
      for (const entry of state.manifest.documents) {
        if (!ids.has(entry.unit_id) || (entry.type !== "xlsx-template" && entry.type !== "pdf-form")) continue;
        const bytes = await deps.archive.get(entry.sha256);
        if (!bytes) {
          log(`  ${entry.unit_id}: ${entry.type} ${entry.sha256.slice(0, 8)} isn't in the archive; skipped`);
          continue;
        }
        try {
          await readDeterministic(byId.get(entry.unit_id), entry, bytes);
        } catch (err) {
          log(`  ${entry.unit_id}: ${errText(err)}`);
        }
      }
      for (const s of targets) publishC1(s);
      progress();
    }

    /* ---------------- discover: ladder steps 2–4 ---------------- */

    async function fetchPage(url: string): Promise<{ html: string; url: string } | null> {
      try {
        const res = await http.get(url);
        if (!res?.ok) return null;
        return { html: new TextDecoder().decode(new Uint8Array(await res.arrayBuffer())), url: res.url || url };
      } catch {
        return null;
      }
    }
    /** Follows URLs a model named: files confirmed by their bytes, pages scanned for CDS links (our code, not the model). */
    async function follow(cands: { kind: "cds" | "cds-index" | "class-profile"; url: string }[]): Promise<Pick<StepFind, "sources" | "index_urls" | "prefetched">> {
      const sources: RecipeSource[] = [];
      const index: string[] = [];
      const prefetched = new Map<string, Prefetched>();
      for (const c of cands) {
        if (c.kind === "class-profile") {
          if (!sources.some((s) => s.kind === "class-profile")) sources.push({ kind: "class-profile", url: c.url, format: "html" });
          continue;
        }
        if (sources.some((s) => s.kind === "cds")) continue;
        if (c.kind === "cds" && /\.(pdf|xlsx?)(\?|$)/i.test(c.url)) {
          const got = await confirmDocument((u) => http.get(u), c.url);
          if (got.ok) {
            sources.push({ kind: "cds", url: c.url, format: got.format });
            prefetched.set(c.url, { bytes: got.bytes, format: got.format });
          }
          continue;
        }
        const page = await fetchPage(c.url);
        if (!page) continue;
        const found = sourcesFromPage(page.html, page.url).sources;
        if (found.length) {
          sources.push(...found.filter((s) => !sources.some((x) => x.url === s.url)));
          index.push(page.url);
        }
      }
      return { sources, index_urls: index, prefetched };
    }

    const paidCost = (unitId: string, before: number) => roundUsd((costBy.get(unitId) ?? 0) - before);

    /** Step 2 as a batch: one Haiku picker request per college with pages, polled until the deadline. */
    async function pickerBatch(colleges: LadderCollege[]): Promise<Map<string, PickResult>> {
      const picks = new Map<string, PickResult>();
      const items = colleges
        .map((c, i) => {
          const links: PageLink[] = (c.seed?.pages ?? []).flatMap((p: ProbePage) => p.links.map((l) => ({ text: l.text, url: l.url })));
          return { c, i, links };
        })
        .filter((x) => x.links.length && stepsFor(tierOf(x.c.school)).includes(2));
      if (!items.length) return picks;
      const linksBy = new Map<string, PageLink[]>();
      const requests = buildPickerRequests(
        items.map(({ c, i, links }) => {
          linksBy.set(c.school.unit_id, links);
          return { tag: sha256(new TextEncoder().encode(links.map((l) => l.url).join("\n"))).slice(0, 8), priority: i, input: { college: { unit_id: c.school.unit_id, name: c.school.name }, links } };
        })
      ).filter((r) => r.params.messages.length);
      const { kept } = trimToCap(requests, spent(), opts.maxCost);
      if (!kept.length) return picks;
      const entries = await submit(api, kept, state.batches, { run: opts.run, phase: "picker", now: deps.now });
      for (const e of entries) summary.batches.push({ id: e.id, requests: e.requests, submitted: e.submitted, ended: null, succeeded: 0, errored: 0, expired: 0, reserved_usd: e.reserved_usd, cost_usd: 0 });
      progress();
      for (const e of entries) {
        // The ladders wait on the pickers, so they wait at most PICKER_WAIT_MS; a late picker is asked interactively.
        const cap = new Date(deps.now().getTime() + PICKER_WAIT_MS);
        const collected = await pollAndCollect(e, opts.pollUntil && opts.pollUntil < cap ? opts.pollUntil : opts.pollUntil ? cap : null);
        if (!collected) continue;
        for (const [id, msg] of collected.succeeded) {
          const p = parseCustomId(id);
          if (!p) continue;
          try {
            picks.set(p.unit_id, parsePickerResponse(msg, linksBy.get(p.unit_id) ?? []));
          } catch (err) {
            log(`  ${p.unit_id}: picker: ${errText(err)}`);
          }
        }
      }
      return picks;
    }

    async function discoverPhase(colleges: LadderCollege[], seeded: boolean) {
      const max = opts.maxDiscoveries ?? 100;
      const ordered = orderColleges(colleges.map((c) => c.school)).slice(0, max);
      const chosen = ordered.map((s) => colleges.find((c) => c.school.unit_id === s.unit_id)!);
      if (!chosen.length) return;
      ladderState.budget.remaining_usd = Math.max(0, opts.maxCost - spent());
      const picks = seeded ? await pickerBatch(chosen) : new Map<string, PickResult>();
      if (stopReason) return;
      const llm: LlmContext = { client, usage: emptyUsage(), today, log, run: opts.run, onCall };
      const paid: LadderDeps = {
        ...freeSteps(http, state.manual),
        pickLinks: async (c, pages) => {
          const before = costBy.get(c.school.unit_id) ?? 0;
          let pick = picks.get(c.school.unit_id);
          if (!pick) {
            const links = pages.flatMap((p) => p.links.map((l) => ({ text: l.text, url: l.url })));
            if (!links.length) return { path: "picker", sources: [], index_urls: [], cost_usd: 0, none_found: true, notes: "no pages to pick from" };
            pick = await pickLinks(callCtx, { college: { unit_id: c.school.unit_id, name: c.school.name }, links, mode: "interactive" });
          }
          const cands = [
            ...(pick.cds_file ? [{ kind: "cds" as const, url: pick.cds_file }] : []),
            ...(pick.cds_index ? [{ kind: "cds-index" as const, url: pick.cds_index }] : []),
            ...(pick.class_profile ? [{ kind: "class-profile" as const, url: pick.class_profile }] : []),
          ];
          const got = await follow(cands);
          const cost = picks.has(c.school.unit_id) ? (pickerCost.get(c.school.unit_id) ?? 0) : paidCost(c.school.unit_id, before);
          return { path: "picker", ...got, cost_usd: cost, model: ROUND3_MODELS.picker, none_found: !got.sources.length };
        },
        searchOnly: async (c) => {
          const before = costBy.get(c.school.unit_id) ?? 0;
          const res = await searchOnly(callCtx, c.school);
          const got = await follow(res.candidates);
          return { path: "search", ...got, cost_usd: paidCost(c.school.unit_id, before), model: ROUND3_MODELS.search, none_found: !got.sources.length };
        },
        discover: async (c) => {
          const before = costBy.get(c.school.unit_id) ?? 0;
          const r = await discover(llm, c.school, { model: REPORTED_MODELS.discovery, job: "discovery", effort: "low" });
          const find: PaidFind = { path: "full", sources: r.sources, index_urls: r.index_urls, cost_usd: paidCost(c.school.unit_id, before), model: r.model, ...(r.notes ? { notes: r.notes } : {}), ...(r.none_found ? { none_found: true } : {}) };
          return find;
        },
      };
      if (seeded) for (const c of chosen) c.recipe = recipes.get(c.school.unit_id) ?? c.recipe;
      // discovery.mts's discoverAll order and passes, but over the colleges this run already chose (its own shouldRetry
      // filter can't see a broken index page found in prepare): the main pass in tier order, then open admission's
      // step 3 while money is left, when the owner allows it.
      const ls: LadderState = { ...ladderState, ...(seeded ? { only: "paid" as const } : {}) };
      const results = new Map<string, LadderResult>();
      for (const c of chosen) {
        if (stopReason) break;
        ls.pass = "main";
        results.set(c.school.unit_id, await ladder(c, ls, paid));
      }
      if (opts.openAdmissionLeftover) {
        for (const c of chosen) {
          const prev = results.get(c.school.unit_id);
          if (stopReason || tierOf(c.school) !== "open admission" || !prev || prev.found || prev.blockedHosts) continue;
          if (ls.budget.remaining_usd < STEP_ESTIMATE_USD[3]) break;
          ls.pass = "leftover";
          const r = await ladder({ school: c.school, recipe: prev.recipe }, ls, paid);
          results.set(c.school.unit_id, { ...r, spent_usd: prev.spent_usd + r.spent_usd, prefetched: new Map([...prev.prefetched, ...r.prefetched]) });
        }
      }
      ladderState.blocked = state.blocked = recordBlocked(mergeBlocked(ladderState.blocked, ls.blocked), http.blockedSeen(), today);
      for (const c of chosen) {
        const r = results.get(c.school.unit_id);
        if (!r) continue;
        summary.discovered++;
        noteLadder(c.school, r, true);
        recipes.set(c.school.unit_id, r.recipe);
        if (r.found) {
          summary.tiers[tierOf(c.school) as ReportedTier].located++;
          await acquire(c.school, r.recipe, { prefetched: r.prefetched });
          noteCdsFound(c.school);
          publishC1(c.school);
        }
        progress();
      }
    }
    /** Picker costs from the collected picker batch, by college. */
    const pickerCost = new Map<string, number>();

    /* ---------------- submit ---------------- */

    /** Model-read documents of these colleges with a call due (and not already in an open batch). */
    function pendingDocs(ids: ReadonlySet<string> | null, only?: CallKey): { entry: ManifestEntry; calls: CallKey[] }[] {
      const open = new Set(state.batches.batches.flatMap((b) => b.custom_ids));
      const out: { entry: ManifestEntry; calls: CallKey[] }[] = [];
      for (const entry of state.manifest.documents) {
        if (ids && !ids.has(entry.unit_id)) continue;
        if (entry.kind !== "cds" || !MODEL_READ.has(entry.type) || !entry.edition) continue;
        const doc = docsOf(entry.unit_id).find((d) => d.sha256 === entry.sha256);
        const due = callsNeedingRead(doc ?? { type: entry.type, reads: {} }).filter((k): k is CallKey => k !== "deterministic" && (!only || k === only));
        const calls = due.filter((call) => !open.has(customId({ unit_id: entry.unit_id, sha256: entry.sha256, call, version: SCHEMA_VERSIONS[call] })));
        if (calls.length) out.push({ entry, calls });
      }
      return out;
    }

    /** Class-profile pages fetched and not yet read (round 2's extractor). */
    function pendingProfiles(ids: ReadonlySet<string> | null): { school: School; src: RecipeSource }[] {
      const out: { school: School; src: RecipeSource }[] = [];
      for (const r of recipes.values()) {
        if (ids && !ids.has(r.unit_id)) continue;
        const school = byId.get(r.unit_id);
        if (!school) continue;
        for (const src of r.sources) if (src.kind === "class-profile" && src.sha256 && src.extraction === undefined) out.push({ school, src });
      }
      return out;
    }

    function priorityOf(order: Map<string, number>, unitId: string) {
      return order.get(unitId) ?? order.size + 1;
    }

    async function pendingDocument(entry: ManifestEntry, calls: CallKey[], priority: number): Promise<PendingDocument | null> {
      const arch = await loadLines(entry);
      if (!arch) {
        log(`  ${entry.unit_id}: ${entry.sha256.slice(0, 8)} isn't in the archive; can't submit`);
        return null;
      }
      const school = byId.get(entry.unit_id);
      const meta = { unit_id: entry.unit_id, ...(school ? { name: school.name } : {}), url: entry.url, edition: entry.edition, document_type: entry.type };
      return { unit_id: entry.unit_id, sha256: entry.sha256, priority, calls: calls.map((call) => ({ input: { call, lines: callLines(arch, call), table, doc: meta }, version: SCHEMA_VERSIONS[call] })) };
    }

    async function submitPhase(ids: ReadonlySet<string> | null, order: Map<string, number>, only?: CallKey) {
      // Class profiles: round 2's interactive extractor, one call each, within the cap.
      if (!only) {
        for (const { school, src } of pendingProfiles(ids)) {
          if (stopReason) return;
          if (spent() + INTERACTIVE_ALLOWANCE_USD > opts.maxCost) {
            log(`Class profiles: the cap of $${opts.maxCost} is reached; the rest wait for the next run`);
            break;
          }
          const bytes = await deps.archive.get(src.sha256!);
          if (!bytes) continue;
          const text = htmlToText(new TextDecoder().decode(bytes));
          const anchor = src.anchor ?? DEFAULT_ANCHORS[src.kind];
          if (!text.toLowerCase().includes(anchor.toLowerCase())) {
            src.extraction = null;
            src.processed = today;
            continue;
          }
          const recording: ModelClient = {
            messages: {
              create: async (body) => {
                const res = await client.messages.create(body);
                onCall(callLogRow({ run: opts.run, at: deps.now().toISOString(), college: school.unit_id, job: "extraction", model: body.model, mode: "interactive", document_type: "class-profile", call: null, estimated_input_tokens: null }, res.usage, res.stop_reason));
                return res;
              },
              stream: (body, o) => client.messages.stream(body, o),
            },
          };
          try {
            src.extraction = await extract({ client: recording, usage: emptyUsage(), today, log }, school, { kind: "class-profile", url: src.url, text: windowAround(text, anchor) }, { model: REPORTED_MODELS.extraction, job: "extraction" });
            src.processed = today;
            summary.documents_read++;
            attempted.add(school.unit_id);
            publishC1(school);
          } catch (err) {
            log(`  ${school.name}: class profile ${src.url}: ${errText(err)}`);
          }
          progress();
        }
      }
      const docs: PendingDocument[] = [];
      for (const { entry, calls } of pendingDocs(ids, only)) {
        const d = await pendingDocument(entry, calls, priorityOf(order, entry.unit_id));
        if (d) docs.push(d);
      }
      if (!docs.length) {
        log("Submit: no model-read document is due a call.");
        return;
      }
      const requests = buildRequests(docs);
      const { kept, trimmed, reserved_usd } = trimToCap(requests, spent(), opts.maxCost);
      if (trimmed.length) log(`Submit: ${trimmed.length} request(s) trimmed to stay under the $${opts.maxCost} cap; their documents stay archived for the next run`);
      if (!kept.length) return;
      const entries = await submit(api, kept, state.batches, { run: opts.run, phase: "extract", now: deps.now });
      for (const e of entries) summary.batches.push({ id: e.id, requests: e.requests, submitted: e.submitted, ended: null, succeeded: 0, errored: 0, expired: 0, reserved_usd: e.reserved_usd, cost_usd: 0 });
      log(`Submitted ${kept.length} extraction request(s) in ${entries.length} batch(es), $${reserved_usd.toFixed(2)} reserved`);
      progress();
    }

    /* ---------------- collect ---------------- */

    /** Waits for one batch until the deadline, then collects it; null when it hasn't ended (it stays open). */
    async function pollAndCollect(entry: BatchEntry, deadline: Date | null = opts.pollUntil ?? null): Promise<Collected | null> {
      let b = await api.retrieve(entry.id);
      while (b.processing_status !== "ended") {
        if (!deadline || deps.now().getTime() + (deps.pollIntervalMs ?? 60_000) > deadline.getTime()) return null;
        await sleep(deps.pollIntervalMs ?? 60_000);
        b = await api.retrieve(entry.id);
      }
      const collected = await collect(api, entry, state.batches, {
        now: deps.now,
        ended: b.ended_at ?? null,
        meta: (id) => {
          const m = entryForCustomId(state.manifest, id);
          return m ? { document_type: m.type } : undefined;
        },
      });
      for (const row of collected.calls) {
        onCall(row);
        if (row.job === "picker") pickerCost.set(row.college, row.cost_usd);
      }
      const i = summary.batches.findIndex((r) => r.id === entry.id);
      if (i >= 0) summary.batches[i] = collected.summary;
      else summary.batches.push(collected.summary);
      return collected;
    }

    /** Applies one succeeded extraction or escalation result to its document's record. */
    async function applyResult(id: string, msg: import("@anthropic-ai/sdk").default.Message, batchId: string): Promise<DocumentRecord | null> {
      const p = parseCustomId(id);
      const entry = entryForCustomId(state.manifest, id);
      if (!p || !entry || p.call === "pick" || !entry.edition) return null;
      const call = p.call;
      const arch = await loadLines(entry);
      if (!arch) {
        log(`  ${id}: archived lines missing; result dropped (resubmitted by the next run)`);
        return null;
      }
      const school = byId.get(entry.unit_id);
      const prior = docsOf(entry.unit_id).find((d) => d.sha256 === entry.sha256) ?? emptyModelRecord(entry, table);
      const escalation = p.job === "escalation";
      const codes = escalation ? (escalationFor(prior, table).find((e) => e.call === call)?.codes ?? []) : codesFor(table, call);
      if (!codes.length) return null;
      let res: ReturnType<typeof parseExtractResponse>;
      try {
        res = parseExtractResponse(msg, { call, codes, lines: callLines(arch, call) });
      } catch (err) {
        queueOne(school, entry.unit_id, [entry.url], [{ check: "batch-failed", detail: `${id}: ${errText(err)}` }], { edition: entry.edition, sha256: entry.sha256, code: `${call}-call` });
        return null;
      }
      if (res.truncated) log(`  ${entry.unit_id} ${call}: hit max_tokens; ${res.missing.length} code(s) unreturned`);
      let doc = itemsFromCall(prior, res, codes, arch, table, { escalation });
      const pages = callLines(arch, call).map((l) => l.page);
      doc = {
        ...doc,
        reads: {
          ...doc.reads,
          [call]: {
            schema_version: escalation ? (prior.reads[call]?.schema_version ?? p.version) : p.version,
            read_by: msg.model,
            mode: "batch",
            batch: batchId,
            extracted: today,
            ...(pages.length ? { pages: [Math.min(...pages), Math.max(...pages)] as [number, number] } : {}),
            ...(res.stop_reason ? { stop: res.stop_reason } : {}),
          },
        },
      };
      const aid = doc.items["H.101"]?.v;
      doc.years = yearsForEdition(entry.edition, { aidYear: typeof aid === "string" ? aid : null });
      if (!doc.years["aid-year"]) {
        // H1, H2, H2A, H6 take their year from H.101; without one they can't publish (the readers' `aid-year` failure).
        for (const code of codes) {
          const it = doc.items[code];
          if (it?.status !== "passed" || table.byCode.get(code)?.year_rule !== "aid-year" || code === "H.101") continue;
          if (!it.failures?.some((f) => f.check === "aid-year")) doc.items[code] = { ...it, status: "failed", failures: [...(it.failures ?? []), { check: "aid-year", detail: `H.101 is ${aid === undefined ? "blank" : `"${aid}"`}, which names no aid year` }] };
        }
      }
      return judgeDoc(school, entry.unit_id, doc, { lines: arch.lines, codes });
    }

    /** Collects every open batch that has ended (waiting until the deadline), then resubmits, escalates, publishes. */
    async function collectPhase(order: Map<string, number>) {
      for (let round = 0; round < 20 && state.batches.batches.length && !stopReason; round++) {
        const open = [...state.batches.batches];
        let progressed = false;
        for (const entry of open) {
          if (stopReason) return;
          const b = await api.retrieve(entry.id);
          if (b.processing_status !== "ended") continue;
          const collected = await pollAndCollect(entry);
          if (!collected) continue;
          progressed = true;
          const changed = new Map<string, DocumentRecord>();
          for (const [id, msg] of collected.succeeded) {
            if (parseCustomId(id)?.job === "picker") continue;
            const doc = await applyResult(id, msg, entry.id);
            if (doc) changed.set(doc.sha256, doc);
          }
          // Errored, expired, and missing requests go again once; a second failure or an invalid request is queued.
          const rebuilt = new Map<string, BatchRequest>();
          for (const id of [...collected.errored, ...collected.expired, ...collected.canceled, ...collected.absent]) {
            const m = entryForCustomId(state.manifest, id);
            const p = parseCustomId(id);
            if (!m || !p || p.call === "pick" || p.job === "escalation") continue;
            const d = await pendingDocument(m, [p.call], priorityOf(order, m.unit_id));
            if (d) rebuilt.set(id, buildRequests([d])[0]);
          }
          const { retry, queue } = resubmitOnce(collected, (id) => rebuilt.get(id) ?? null);
          for (const q of queue) {
            const m = entryForCustomId(state.manifest, q.custom_id);
            if (m) queueOne(byId.get(m.unit_id), m.unit_id, [m.url], [{ check: "batch-failed", detail: `${q.custom_id}: ${q.reason}` }], { edition: m.edition ?? undefined, sha256: m.sha256, code: `${parseCustomId(q.custom_id)?.call}-call` });
          }
          if (retry.length) {
            const entries = await submit(api, retry, state.batches, { run: opts.run, phase: entry.phase, now: deps.now, resubmits: new Set(retry.map((r) => r.custom_id)) });
            for (const e of entries) summary.batches.push({ id: e.id, requests: e.requests, submitted: e.submitted, ended: null, succeeded: 0, errored: 0, expired: 0, reserved_usd: e.reserved_usd, cost_usd: 0 });
            log(`Resubmitted ${retry.length} errored or expired request(s) once`);
          }
          // Escalation (Decision 9): once per failing call, Sonnet 5 re-reads only that call's pages for the failing codes.
          const esc = [];
          const openIds = new Set(state.batches.batches.flatMap((b) => b.custom_ids));
          for (const doc of changed.values()) {
            const m = state.manifest.documents.find((d) => d.sha256 === doc.sha256)!;
            const arch = await loadLines(m);
            if (!arch) continue;
            const school = byId.get(m.unit_id);
            for (const e of escalationFor(doc, table)) {
              const version = doc.reads[e.call]?.schema_version ?? SCHEMA_VERSIONS[e.call];
              if (openIds.has(customId({ unit_id: m.unit_id, sha256: m.sha256, call: e.call, version, job: "escalation" }))) continue;
              const pages = e.pages ?? [1, Math.max(1, ...arch.pages)];
              const numbered = arch.lines.map((text, i) => ({ id: i + 1, page: arch.pages[i] ?? 1, text }));
              esc.push({ sha256: m.sha256, priority: priorityOf(order, m.unit_id), version, input: { call: e.call, lines: numbered, failingCodes: e.codes, pageRange: pages, table, doc: { unit_id: m.unit_id, ...(school ? { name: school.name } : {}), url: m.url, edition: m.edition, document_type: m.type } } });
            }
          }
          if (esc.length) {
            const { kept } = trimToCap(buildEscalationRequests(esc), spent(), opts.maxCost);
            if (kept.length) {
              const entries = await submit(api, kept, state.batches, { run: opts.run, phase: "escalate", now: deps.now });
              for (const e of entries) summary.batches.push({ id: e.id, requests: e.requests, submitted: e.submitted, ended: null, succeeded: 0, errored: 0, expired: 0, reserved_usd: e.reserved_usd, cost_usd: 0 });
              summary.escalated += kept.length;
              log(`Escalated ${kept.length} failing call(s) to ${REPORTED_MODELS.escalation}`);
            }
          }
          for (const doc of changed.values()) {
            const m = state.manifest.documents.find((d) => d.sha256 === doc.sha256)!;
            const school = byId.get(m.unit_id);
            if (school) publishC1(school);
          }
          log(`Collected batch ${entry.id}: ${collected.succeeded.size} succeeded, ${collected.errored.length + collected.invalid_request.length} errored, ${collected.expired.length + collected.absent.length} expired · run cost so far ~$${summaryCost(summary).toFixed(2)}`);
          progress();
        }
        if (!state.batches.batches.length) break;
        if (!progressed) {
          const deadline = opts.pollUntil ?? null;
          if (!deadline || deps.now().getTime() + (deps.pollIntervalMs ?? 60_000) > deadline.getTime()) break;
          await sleep(deps.pollIntervalMs ?? 60_000);
          round--;
        }
      }
    }

    /* ---------------- projection ---------------- */

    function computeProjection(ids: ReadonlySet<string> | null, paid: LadderCollege[], only?: CallKey): CostProjection {
      const documents: Partial<Record<DocumentType, number>> = {};
      for (const { entry, calls } of pendingDocs(ids, only)) documents[entry.type] = (documents[entry.type] ?? 0) + calls.length / CALL_KEYS.length;
      if (!only) {
        const profiles = pendingProfiles(ids).length;
        if (profiles) documents["class-profile"] = profiles;
      }
      const capped = paid.slice(0, opts.maxDiscoveries ?? 100);
      const steps = (s: School) => stepsFor(tierOf(s), { pass: "main" });
      const discovery = {
        picker: capped.filter((c) => steps(c.school).includes(2)).length,
        search: capped.filter((c) => steps(c.school).includes(3) || (opts.openAdmissionLeftover && tierOf(c.school) === "open admission")).length,
        full: capped.filter((c) => steps(c.school).includes(4)).length,
      };
      return projection({ documents, discovery, scale: opts.scale ?? 1 });
    }

    /* ---------------- the run ---------------- */

    const targets = opts.schools;
    const ids = new Set(targets.map((s) => s.unit_id));
    const order = new Map(orderColleges(targets).map((s, i) => [s.unit_id, i]));
    const phase = opts.phase;
    let guardMessage: string | null = null;

    try {
      if (opts.reextract) {
        // Archive only: no fetch, no discovery (Decision 10).
        await rereadDeterministic(targets);
        summary.projection = computeProjection(ids, [], opts.reextract);
        log(`Projection: $${(summary.projection.run_usd ?? summary.projection.full_run_usd).toFixed(2)} this run (${summary.projection.basis})`);
        const g = projectionGuard(summary.projection, Math.max(0, opts.maxCost - spent()));
        if (g.stop) guardMessage = g.message;
        else {
          await submitPhase(ids, order, opts.reextract);
          if (phase === "all" || phase === "collect") await collectPhase(order);
        }
      } else {
        if (phase === "prepare" || phase === "all") await prepare(targets);
        const needsPaid = phase === "all" ? forPaid : phase === "discover" ? targets.filter((s) => shouldRetry(recipes.get(s.unit_id), today, { unitId: s.unit_id, manual: state.manual })).map((s) => ({ school: s, recipe: recipes.get(s.unit_id) })) : [];
        if (phase !== "collect") {
          summary.projection = computeProjection(ids, phase === "prepare" || phase === "all" ? forPaid : needsPaid);
          log(`Projection: $${(summary.projection.run_usd ?? summary.projection.full_run_usd).toFixed(2)} this run, $${summary.projection.full_run_usd.toFixed(2)} for the full run (${summary.projection.basis})`);
          progress();
        }
        if (phase !== "prepare" && phase !== "collect" && !stopReason) {
          // The guard before any model call: this run's projection must fit what is left of the cap.
          const g = projectionGuard(summary.projection!, Math.max(0, opts.maxCost - spent()));
          if (g.stop) guardMessage = g.message;
        }
        if (!guardMessage && !stopReason) {
          if (phase === "discover" || phase === "all") await discoverPhase(needsPaid, phase === "all");
          if (!stopReason && (phase === "submit" || phase === "all")) await submitPhase(ids, order);
          if (!stopReason && (phase === "collect" || phase === "all")) await collectPhase(order);
        }
      }
    } catch (err) {
      if (!stopReason) throw err;
    }

    /* ---------------- finish ---------------- */

    summary.attempted += attempted.size;
    const touched = [...touchedDocs.values()];
    const touchedRecords = [...new Set([...attempted])].map((id) => state.records.get(id)).filter((r): r is CollegeRecord => !!r);
    const tripped = circuitBreakerV3({ attempted: summary.attempted, failedC1: failedC1Count(touchedRecords, table), itemFailureShares: itemFailureShares(touched, table), changed: summary.changed, priorValues });
    summary.tripped = tripped;
    summary.finished = deps.now().toISOString();
    const stopped = stopReason ?? guardMessage;
    summary.status = stopped ? "stopped" : "finished";
    if (stopped) summary.stopped_reason = stopped;
    progress();
    if (stopped) return { exit: 3, message: stopped };
    if (tripped) return { exit: 2, message: tripped };
    return { exit: 0 };
  }

  return { run };
}

/** Two copies of the blocked-host file merged (colleges prepared at once each update their own copy). */
export function mergeBlocked(a: BlockedHostsFile, b: BlockedHostsFile): BlockedHostsFile {
  const byHost = new Map(a.hosts.map((h) => [h.host, h]));
  for (const h of b.hosts) {
    const prev = byHost.get(h.host);
    if (!prev) byHost.set(h.host, h);
    else {
      const ids = [...new Set([...(prev.unit_ids ?? []), ...(h.unit_ids ?? [])])].sort();
      byHost.set(h.host, { ...(h.last_seen >= prev.last_seen ? h : prev), first_seen: prev.first_seen < h.first_seen ? prev.first_seen : h.first_seen, ...(ids.length ? { unit_ids: ids } : {}) });
    }
  }
  return { hosts: [...byHost.values()].sort((x, y) => (x.host < y.host ? -1 : x.host > y.host ? 1 : 0)) };
}
