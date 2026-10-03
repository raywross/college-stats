/**
 * The college-reported ingestion pipeline (specs/college-reported-data.md "How it works"), with its outside world
 * injected so tests run without network or an API key:
 *
 *   const pipeline = createPipeline({ client, fetch, now });
 *   const result = await pipeline.run({ schools, sources, reported, queue, run: "…" });
 *
 * `run` works on the files' contents in memory and returns the updated contents plus a RunSummary; the CLI
 * (scripts/sync-college-reported.mts) reads and writes the files.
 *
 * Per college: when there's no recipe (or --rediscover), first guess next year's CDS URL from the one we know (no
 * model), else discovery (links only) → re-check index pages for new links → fetch each source conditionally (304 or
 * same hash = skip the model) → read changed documents (Excel CDS deterministically, PDF and HTML with the extraction
 * model) → checks → publish, or escalate only where a model can help (specs/college-reported-round-2.md, decision 3):
 *   - every source failed to fetch (blocked, 404, network) → review queue as `unreachable`, no model call;
 *   - anchor not found / unreadable document → one Sonnet re-discovery (effort medium), re-extract;
 *   - a check failed on real figures → one re-extraction with the stronger model from the same cached document;
 *   still failing → review queue. The run stops before a college starts once its logged cost reaches `maxCost`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CIRCUIT_BREAKER,
  DEFAULT_ANCHORS,
  REPORTED_MODELS,
  fallYear,
  type CheckFailure,
  type Extraction,
  type Recipe,
  type RecipeSource,
  type ReportedEntry,
  type ReportedFile,
  type ReviewItem,
  type ReviewQueueFile,
  type RunSummary,
  type SourcesFile,
} from "../../../lib/reported.ts";
import type { School } from "../../../lib/types";
import { readC1, readWorkbook, sheetText, workbookEdition } from "../cds-xlsx.mts";
import { runChecks, toReportedEntry } from "../../../lib/reported-checks.ts";
import { SCANNED_TEXT_CHARS, detectFormat, entryYearOf, htmlToText, newSourcesFromIndex, pagesText, pdfPages, selectPages, windowAround } from "./documents.mts";
import { PoliteHttp, cacheDocument, isBlocked, sha256, type FetchFn } from "./http.mts";
import { guessNextEditionUrls } from "./guess.mts";
import { discover, extract, type DocumentInput, type LlmContext } from "./llm.mts";
import { emptyUsage, type Job, type ModelClient } from "./models.mts";

export interface PipelineDeps {
  client: ModelClient;
  fetch: FetchFn;
  now: () => Date;
  /** Waits between requests to one host; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between requests to one host (default 1,000 ms). */
  minDelayMs?: number;
  /** Where downloads are cached by hash (default .cache/college-docs). */
  cacheDir?: string;
  /** Colleges processed at once (requests to one host are still serialized). Default 4. */
  concurrency?: number;
  log?: (msg: string) => void;
  /**
   * Called after each college finishes, with the files' contents and a summary as they stand (status "running"), so
   * the CLI can write them as it goes: a run that stops or is cancelled keeps every college it finished.
   */
  onProgress?: (snapshot: RunOutput) => void;
}

/**
 * An API error that will fail every later call too, so the run stops instead of failing each remaining college:
 * a bad or revoked key, or the account's spend limit or credit balance reached. Duck-typed on `status` and `message`
 * so it works for the SDK's error classes and for test fakes.
 */
export function fatalApiError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const status = (err as { status?: unknown }).status;
  const message = String((err as { message?: unknown }).message ?? "");
  if (status === 401 || status === 403) return `the API key was refused (HTTP ${status}): ${message.slice(0, 200)}`;
  if ((status === 400 || status === 429) && /usage limit|spend limit|credit balance|billing/i.test(message)) {
    return `the Anthropic account's spend limit or credit balance was reached: ${message.slice(0, 200)}`;
  }
  return null;
}

export interface RunInput {
  /** The colleges to process this run. */
  schools: School[];
  sources: SourcesFile;
  reported: ReportedFile;
  queue: ReviewQueueFile;
  run: string;
  /** Ignore stored recipes and run discovery again. */
  rediscover?: boolean;
  /** Most discoveries (Sonnet + web search) this run may start; colleges past it without a recipe are skipped. */
  maxDiscoveries?: number;
  /**
   * The run's dollar cap (logged, estimated cost). Checked before each college starts: once the cost so far plus
   * COLLEGE_ALLOWANCE_USD reaches it, the run stops like a spend-limit error (status "stopped"). No cap when absent.
   */
  maxCost?: number;
}

/** What one college may cost, at most, in the cost-cap check (a discovery plus a re-extraction, with room to spare). */
export const COLLEGE_ALLOWANCE_USD = 0.5;

export interface RunOutput {
  sources: SourcesFile;
  reported: ReportedFile;
  queue: ReviewQueueFile;
  summary: RunSummary;
}

const ROOT = join(import.meta.dirname, "..", "..", "..");
export const DEFAULT_CACHE_DIR = join(ROOT, ".cache", "college-docs");

/** Why the run's output must not auto-merge, or null. Limits are shares strictly greater than CIRCUIT_BREAKER's. */
export function circuitBreaker(c: { attempted: number; failed: number; changed: number; priorValues: number }): string | null {
  const reasons: string[] = [];
  if (c.attempted > 0 && c.failed / c.attempted > CIRCUIT_BREAKER.maxFailureShare) {
    reasons.push(`${c.failed} of ${c.attempted} attempted colleges failed checks (limit ${CIRCUIT_BREAKER.maxFailureShare * 100}%)`);
  }
  if (c.priorValues > 0 && c.changed / c.priorValues > CIRCUIT_BREAKER.maxChangedShare) {
    reasons.push(`${c.changed} of ${c.priorValues} published values changed (limit ${CIRCUIT_BREAKER.maxChangedShare * 100}%)`);
  }
  return reasons.length ? reasons.join("; ") : null;
}

const VALUE_KEYS = ["applicants", "admitted", "enrolled", "acceptance_rate"] as const;
const countValues = (e: ReportedEntry) => VALUE_KEYS.filter((k) => e.admissions[k] !== null).length;
const hasFigures = (e: Extraction | null | undefined): e is Extraction =>
  !!e && (e.applicants !== null || e.admitted !== null || e.enrolled !== null || e.acceptance_rate !== null);

/** Values of `prev` that a same-term `next` changed. A new entering term is a new year, not a change. */
function changedValues(prev: ReportedEntry | undefined, next: ReportedEntry): number {
  if (!prev || prev.admissions.entering_term !== next.admissions.entering_term) return 0;
  return VALUE_KEYS.filter((k) => prev.admissions[k] !== null && prev.admissions[k] !== next.admissions[k]).length;
}

/** A fresh recipe keeps what we knew about documents it shares with the old one, so unchanged files stay skipped. */
function carryState(fresh: Recipe, old: Recipe | undefined): Recipe {
  if (!old) return fresh;
  const byUrl = new Map(old.sources.map((s) => [s.url, s]));
  return {
    ...fresh,
    sources: fresh.sources.map((s) => {
      const o = byUrl.get(s.url);
      return o ? { ...s, etag: o.etag, last_modified: o.last_modified, sha256: o.sha256, processed: o.processed, extraction: o.extraction } : s;
    }),
  };
}

/** "2025-26" (CDS edition) → "Fall 2025". */
const termFromEdition = (edition: string | null) => (edition ? `Fall ${edition.slice(0, 4)}` : null);
const fmt = (n: number) => n.toLocaleString("en-US");

type SourceRead =
  | { state: "unchanged" }
  | { state: "read" }
  /** Couldn't fetch it: robots.txt, 401/403/405/429 or another HTTP error (404), a network error. No model can help. */
  | { state: "unreachable"; detail: string }
  /** Fetched but no figures read: anchor not found, unreadable document, extraction error. */
  | { state: "problem"; detail: string };

type Outcome =
  | { status: "unchanged" }
  | { status: "stale"; reason: string }
  | { status: "published"; entry: ReportedEntry }
  | { status: "unreachable"; failures: CheckFailure[]; urls: string[] }
  | {
      status: "failed";
      failures: CheckFailure[];
      extraction: Extraction | null;
      urls: string[];
      /** Sources whose figures failed a check on real figures (re-extracted once by the stronger model). */
      failing: RecipeSource[];
      /** Documents fetched but not read (missing anchor, unreadable); re-discovery may find better links. */
      problems: string[];
    };

export function createPipeline(deps: PipelineDeps) {
  const log = deps.log ?? ((m: string) => console.log(m));
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR;
  const http = new PoliteHttp({
    fetch: deps.fetch,
    now: () => deps.now().getTime(),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    minDelayMs: deps.minDelayMs ?? 1000,
    log,
  });

  async function run(input: RunInput): Promise<RunOutput> {
    const started = deps.now().toISOString();
    const today = started.slice(0, 10);
    const usage = emptyUsage();
    // Set by the first fatal API error (fatalApiError) or the cost cap: no new college starts, and colleges in flight
    // record nothing.
    let stopReason: string | null = null;
    const stopped = () => stopReason !== null;
    async function guarded<T>(call: () => Promise<T>): Promise<T> {
      if (stopReason) throw new Error(`run stopped: ${stopReason}`);
      try {
        return await call();
      } catch (err) {
        const fatal = fatalApiError(err);
        if (fatal && !stopReason) {
          stopReason = fatal;
          log(`\nStopping: ${fatal}. Colleges already finished are kept.`);
        }
        throw err;
      }
    }
    const client: ModelClient = {
      messages: {
        create: (body) => guarded(() => deps.client.messages.create(body)),
        stream: (body) => ({ finalMessage: () => guarded(() => deps.client.messages.stream(body).finalMessage()) }),
      },
    };
    const ctx: LlmContext = { client, usage, today, log };
    const maxDiscoveries = input.maxDiscoveries ?? 100;
    const counts = { attempted: 0, documents_read: 0, published: 0, changed: 0, failed: 0, unreachable: 0, discovered: 0, guessed: 0, escalated: 0 };

    const recipes = new Map(input.sources.recipes.map((r) => [r.unit_id, r]));
    const entries = new Map(input.reported.entries.map((e) => [e.unit_id, e]));
    const priorValues = input.reported.entries.reduce((n, e) => n + countValues(e), 0);
    let items = [...input.queue.items];
    /** Documents a URL guess already downloaded, handed to the first read so they aren't fetched twice. */
    const prefetched = new Map<string, Response>();

    /* ---------------- one document ---------------- */

    async function readSource(school: School, src: RecipeSource, o: { force: boolean; model: string; job: Job }): Promise<SourceRead> {
      const conditional = !o.force && src.sha256 ? { etag: src.etag, last_modified: src.last_modified } : {};
      let res: Response | null;
      const pre = prefetched.get(src.url);
      if (pre) {
        prefetched.delete(src.url);
        res = pre;
      } else {
        try {
          res = await http.get(src.url, conditional);
        } catch (err) {
          return { state: "unreachable", detail: `${src.url}: ${err instanceof Error ? err.message : err}` };
        }
      }
      if (!res) return { state: "unreachable", detail: `robots.txt disallows ${src.url}` };
      if (res.status === 304) return { state: "unchanged" };
      if (isBlocked(res)) log(`  ${src.url}: HTTP ${res.status} (bot protection or rate limit); not retried`);
      if (!res.ok) return { state: "unreachable", detail: `HTTP ${res.status} at ${src.url}` };
      const bytes = new Uint8Array(await res.arrayBuffer());
      const hash = sha256(bytes);
      const etag = res.headers.get("etag") ?? undefined;
      const lastModified = res.headers.get("last-modified") ?? undefined;
      if (!o.force && hash === src.sha256) {
        src.etag = etag ?? src.etag;
        src.last_modified = lastModified ?? src.last_modified;
        return { state: "unchanged" };
      }
      const read = await readBytes(school, src, bytes, hash, detectFormat(bytes, res.headers.get("content-type"), src.url), o);
      if (read.state !== "read") return read;
      if (etag) src.etag = etag;
      else delete src.etag;
      if (lastModified) src.last_modified = lastModified;
      else delete src.last_modified;
      return read;
    }

    /** Reads downloaded bytes (cached by hash) into `src.extraction`. */
    async function readBytes(
      school: School,
      src: RecipeSource,
      bytes: Uint8Array,
      hash: string,
      format: RecipeSource["format"],
      o: { model: string; job: Job }
    ): Promise<SourceRead> {
      const file = cacheDocument(cacheDir, hash, bytes);
      counts.documents_read++;
      let extraction: Extraction | null;
      try {
        const got = await readDocument(school, src, { file, bytes, format }, o);
        if ("problem" in got) return { state: "problem", detail: got.problem };
        extraction = got.extraction;
      } catch (err) {
        return { state: "problem", detail: `${src.url}: ${err instanceof Error ? err.message : err}` };
      }
      Object.assign(src, { format, sha256: hash, processed: today, extraction });
      return { state: "read" };
    }

    /**
     * The stronger extractor's one re-read of a document whose figures failed a check: from the cached copy when we
     * have it (same bytes, no refetch), else fetched again.
     */
    async function reextract(school: School, src: RecipeSource): Promise<SourceRead> {
      const o = { force: true, model: REPORTED_MODELS.escalation, job: "escalation" as const };
      const file = src.sha256 ? join(cacheDir, src.sha256) : null;
      if (src.sha256 && file && existsSync(file)) return readBytes(school, src, new Uint8Array(readFileSync(file)), src.sha256, src.format, o);
      return readSource(school, src, o);
    }

    async function readDocument(
      school: School,
      src: RecipeSource,
      doc: { file: string; bytes: Uint8Array; format: RecipeSource["format"] },
      o: { model: string; job: Job }
    ): Promise<{ extraction: Extraction } | { problem: string }> {
      const ask = (d: Omit<DocumentInput, "kind" | "url">) => extract(ctx, school, { kind: src.kind, url: src.url, ...d }, o);
      // Discovery returns links only, so most sources carry no anchor: the extractor finds its section itself.
      const anchor = src.anchor ?? DEFAULT_ANCHORS[src.kind];
      if (doc.format === "xlsx") {
        const book = readWorkbook(doc.file);
        const c1 = readC1(book);
        const term = termFromEdition(workbookEdition(book)) ?? (entryYearOf(src.url) ? `Fall ${entryYearOf(src.url)}` : null);
        if (c1.applicants !== null && c1.admitted !== null && term) {
          for (const w of c1.warnings) log(`  ${school.name}: ${w}`);
          const label = { applicants: "applied", admitted: "were admitted", enrolled: "enrolled" } as const;
          const quotes: Extraction["quotes"] = {};
          for (const k of ["applicants", "admitted", "enrolled"] as const) {
            if (c1[k] !== null) quotes[k] = `C1 Total first-time, first-year students who ${label[k]}: ${fmt(c1[k]!)}`;
          }
          const extraction: Extraction = { cohort: "first-year", scope: "all-rounds", entering_term: term, applicants: c1.applicants, admitted: c1.admitted, enrolled: c1.enrolled, acceptance_rate: null, quotes, page: null };
          return { extraction };
        }
        const text = sheetText(book.get("CDS-C")) || [...book.values()].map(sheetText).join("\n\n");
        if (!text.trim()) return { problem: `${src.url}: workbook has no readable sheets` };
        return { extraction: await ask({ text: windowAround(text, anchor) }) };
      }
      if (doc.format === "pdf") {
        const pages = await pdfPages(doc.bytes);
        const chars = pages.reduce((n, p) => n + p.trim().length, 0);
        if (chars < SCANNED_TEXT_CHARS) {
          if (pages.length > 100) return { problem: `${src.url}: scanned PDF of ${pages.length} pages is too long to send` };
          return { extraction: await ask({ pdfBase64: Buffer.from(doc.bytes).toString("base64") }) };
        }
        const which = selectPages(pages, src.pages, anchor);
        if (!which.length) return { problem: `anchor "${anchor}" not found in ${src.url}` };
        return { extraction: await ask({ text: pagesText(pages, which) }) };
      }
      const text = htmlToText(new TextDecoder().decode(doc.bytes));
      if (!text.toLowerCase().includes(anchor.toLowerCase())) return { problem: `anchor "${anchor}" not found in ${src.url}` };
      return { extraction: await ask({ text: windowAround(text, anchor) }) };
    }

    /* ---------------- one recipe ---------------- */

    async function attempt(school: School, recipe: Recipe, o: { force: boolean; model: string; job: Job }): Promise<Outcome> {
      for (const idx of recipe.index_urls) {
        try {
          const res = await http.get(idx);
          if (!res || !res.ok) continue;
          const html = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
          for (const s of newSourcesFromIndex(html, idx, recipe.sources)) {
            log(`  ${school.name}: new ${s.kind} link on ${idx}: ${s.url}`);
            recipe.sources.push(s);
          }
        } catch (err) {
          log(`  ${idx}: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (!recipe.sources.length) return { status: "stale", reason: "the recipe lists no documents" };
      const reads = await Promise.all(recipe.sources.map((s) => readSource(school, s, o)));
      const unreachable = reads.flatMap((r) => (r.state === "unreachable" ? [r.detail] : []));
      const problems = reads.flatMap((r) => (r.state === "problem" ? [r.detail] : []));
      for (const r of reads) if (r.state === "unreachable" || r.state === "problem") log(`  ${school.name}: ${r.detail}`);
      // Every source failed to fetch: no model can fix a blocked site or a missing file, so no model is called.
      if (unreachable.length === reads.length) {
        return { status: "unreachable", failures: unreachable.map((detail) => ({ check: "unreachable" as const, detail })), urls: recipe.sources.map((s) => s.url) };
      }
      if (!reads.some((r) => r.state === "read") && !problems.length) return { status: "unchanged" };
      return judge(school, recipe, problems);
    }

    /** Runs the checks over every source's extraction: publish the newest passing one, else say what failed. */
    function judge(school: School, recipe: Recipe, problems: string[]): Outcome {
      const withFigures = recipe.sources.filter((s) => hasFigures(s.extraction));
      const extractions = withFigures.map((s) => s.extraction!);
      const judged = withFigures.map((s) => ({ src: s, e: s.extraction!, failures: runChecks(s.extraction!, school, extractions) }));
      const newestFirst = (a: (typeof judged)[number], b: (typeof judged)[number]) =>
        (fallYear(b.e.entering_term) ?? 0) - (fallYear(a.e.entering_term) ?? 0) ||
        VALUE_KEYS.filter((k) => b.e[k] !== null).length - VALUE_KEYS.filter((k) => a.e[k] !== null).length ||
        (a.src.kind === "cds" ? -1 : 1);
      const passing = judged.filter((j) => !j.failures.length).sort(newestFirst);
      if (passing.length) {
        const best = passing[0];
        return { status: "published", entry: toReportedEntry(best.e, school, { url: best.src.url, kind: best.src.kind, retrieved: best.src.processed ?? today, page: best.e.page }, input.run) };
      }
      // Only "not newer than federal": the college hasn't published a newer year yet. Not a failure.
      const real = judged.filter((j) => !j.failures.every((f) => f.check === "newer-than-federal")).sort(newestFirst);
      if (!real.length && !problems.length) return { status: "stale", reason: "nothing newer than the federal year" };
      const worst = real[0];
      const failures: CheckFailure[] = [
        ...(worst?.failures ?? []),
        // Missing anchors and unreadable documents: no number could be quoted, so they're reported as quote failures.
        ...problems.map((detail) => ({ check: "quote-present" as const, detail: `no figures read: ${detail}` })),
      ];
      return { status: "failed", failures, extraction: worst?.e ?? null, urls: worst ? [worst.src.url] : recipe.sources.map((s) => s.url), failing: real.map((j) => j.src), problems };
    }

    /* ---------------- one college ---------------- */

    let discoveries = 0;
    const canDiscover = () => discoveries < maxDiscoveries;

    /** Discovery (links only) with the Sonnet model: effort low the first time, medium on the one re-discovery. */
    async function learn(school: School, old: Recipe | undefined, effort: "low" | "medium"): Promise<Recipe | null> {
      discoveries++;
      counts.discovered++;
      const model = REPORTED_MODELS.discovery;
      try {
        const fresh = await discover(ctx, school, { model, job: "discovery", effort });
        log(`  ${school.name}: ${model} found ${fresh.sources.length} source(s)${fresh.none_found ? " (none newer)" : ""}`);
        return carryState(fresh, old);
      } catch (err) {
        log(`  ${school.name}: discovery with ${model} failed: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }

    /**
     * Next year's CDS, guessed from the CDS URL we already know (`school.cds.url`, or the old recipe's CDS sources) by
     * changing the edition in the file name. A guess that returns a PDF or Excel file becomes the recipe: no model call.
     */
    async function guess(school: School, old: Recipe | undefined): Promise<Recipe | null> {
      const known = old?.sources.filter((s) => s.kind === "cds") ?? [];
      const bases = [...new Set([school.cds?.url, ...known.map((s) => s.url)].filter((u): u is string => !!u))];
      const tried = new Set<string>();
      for (const base of bases) {
        for (const url of guessNextEditionUrls(base, school.admissions.year ?? 0)) {
          if (tried.has(url)) continue;
          tried.add(url);
          const prior = known.find((s) => s.url === url);
          let res: Response | null;
          try {
            res = await http.get(url, prior?.sha256 ? { etag: prior.etag, last_modified: prior.last_modified } : {});
          } catch {
            continue;
          }
          if (!res) continue;
          let format: RecipeSource["format"];
          if (res.status === 304 && prior) format = prior.format;
          else if (res.status === 200) {
            const bytes = new Uint8Array(await res.arrayBuffer());
            // From the bytes and content type only: the guessed URL's own extension proves nothing.
            format = detectFormat(bytes, res.headers.get("content-type"), "");
            if (format === "html") continue; // e.g. a "not found" page served with 200
            prefetched.set(url, new Response(bytes, { status: 200, headers: res.headers }));
          } else {
            await res.body?.cancel().catch(() => {});
            continue;
          }
          log(`  ${school.name}: guessed the next CDS edition: ${url}`);
          const fresh: Recipe = {
            unit_id: school.unit_id,
            sources: [{ kind: "cds", url, format }, ...(old?.sources.filter((s) => s.kind !== "cds") ?? [])],
            index_urls: old?.index_urls ?? [],
            learned: today,
            model: "guessed",
            notes: `CDS URL guessed from ${base}`,
          };
          return carryState(fresh, old);
        }
      }
      return null;
    }

    const emptyExtraction = (): Extraction => ({ cohort: "unknown", scope: "unknown", entering_term: null, applicants: null, admitted: null, enrolled: null, acceptance_rate: null, quotes: {}, page: null });

    function enqueue(school: School, urls: string[], extraction: Extraction | null, failures: CheckFailure[]) {
      const item: ReviewItem = {
        unit_id: school.unit_id,
        name: school.name,
        urls,
        entering_term: extraction?.entering_term ?? null,
        extraction: extraction ?? emptyExtraction(),
        failures,
        queued: today,
        run: input.run,
      };
      items = [...items.filter((i) => i.unit_id !== school.unit_id), item];
    }

    async function processCollege(school: School): Promise<void> {
      const stored = recipes.get(school.unit_id);
      let recipe = stored ? structuredClone(stored) : undefined;
      // A recipe found this run, by a guessed URL or by discovery.
      let learnedNow = false;
      if (!recipe || input.rediscover) {
        const guessed = await guess(school, recipe);
        if (guessed) {
          recipe = guessed;
          learnedNow = true;
          counts.guessed++;
        } else if (!canDiscover()) {
          if (!recipe) return void log(`${school.name}: no recipe and the discovery budget is spent; skipped`);
        } else {
          const fresh = await learn(school, recipe, "low");
          if (stopped()) return;
          if (fresh) {
            recipe = fresh;
            learnedNow = true;
          } else if (!recipe) {
            counts.attempted++;
            return;
          }
        }
      }
      if (recipe!.none_found) {
        if (learnedNow) counts.attempted++;
        recipes.set(school.unit_id, recipe!);
        return void log(`${school.name}: nothing newer published${learnedNow ? "" : " (per recipe; re-checked on --rediscover)"}`);
      }

      let current = recipe!;
      let out = await attempt(school, current, { force: false, model: REPORTED_MODELS.extraction, job: "extraction" });
      if (out.status === "failed" && !stopped()) {
        if (out.failing.length) {
          // Real figures failed a check: the stronger extractor re-reads the same documents once (no new search).
          counts.escalated++;
          log(`${school.name}: checks failed (${out.failures.map((f) => f.check).join(", ")}); re-reading with ${REPORTED_MODELS.escalation}`);
          for (const src of out.failing) {
            const r = await reextract(school, src);
            if (r.state === "problem" || r.state === "unreachable") log(`  ${school.name}: ${r.detail}`);
          }
          if (!stopped()) out = judge(school, current, out.problems);
        } else if (canDiscover()) {
          // Nothing could be read (anchor missing, unreadable file): better links may help, so re-discover once.
          counts.escalated++;
          log(`${school.name}: no figures read; re-discovering (effort medium)`);
          const again = await learn(school, current, "medium");
          if (again && !again.none_found && !stopped()) {
            out = await attempt(school, again, { force: true, model: REPORTED_MODELS.extraction, job: "extraction" });
            current = again;
          }
        }
      }
      // A college cut off by a fatal API error isn't a result: record nothing, so the next run does it again.
      if (stopped()) return;
      recipes.set(school.unit_id, current);

      if (out.status === "unchanged") {
        if (learnedNow) counts.attempted++;
        return void log(`${school.name}: unchanged`);
      }
      counts.attempted++;
      if (out.status === "stale") return void log(`${school.name}: ${out.reason}`);
      if (out.status === "published") {
        const prev = entries.get(school.unit_id);
        const same = prev && JSON.stringify(prev.admissions) === JSON.stringify(out.entry.admissions);
        items = items.filter((i) => i.unit_id !== school.unit_id);
        if (same) return void log(`${school.name}: re-read, same figures`);
        counts.changed += changedValues(prev, out.entry);
        counts.published++;
        entries.set(school.unit_id, out.entry);
        const a = out.entry.admissions;
        return void log(`${school.name}: published ${a.entering_term} (${a.source_kind}): ${a.applicants ?? "–"} applied, ${a.admitted ?? "–"} admitted`);
      }
      if (out.status === "unreachable") {
        // Not a check failure: the breaker doesn't count it.
        counts.unreachable++;
        enqueue(school, out.urls, null, out.failures);
        return void log(`${school.name}: unreachable, to the review queue (${out.failures.map((f) => f.detail).join("; ")})`);
      }
      counts.failed++;
      enqueue(school, out.urls, out.extraction, out.failures);
      log(`${school.name}: to the review queue (${out.failures.map((f) => `${f.check}: ${f.detail}`).join("; ")})`);
    }

    /* ---------------- all colleges ---------------- */

    const total = input.schools.length;
    let done = 0;
    const totalCost = () => Object.values(usage).reduce((n, u) => n + u.cost_usd, 0);
    // Set when the run's cost cap is reached: no new college starts, but colleges in flight finish and are kept.
    let capReason: string | null = null;
    /** Checked before each college starts: the logged cost plus one college's allowance must stay under the cap. */
    function capReached(): boolean {
      if (capReason) return true;
      if (input.maxCost === undefined || totalCost() + COLLEGE_ALLOWANCE_USD < input.maxCost) return false;
      capReason = `the run's cost cap of $${input.maxCost} was reached`;
      log(`\nStopping: ${capReason} (~$${totalCost().toFixed(2)} logged). Colleges already finished are kept.`);
      return true;
    }

    /** The files' contents and summary as they stand; `final` marks the run finished or stopped. */
    function snapshot(final: boolean): RunOutput {
      const summary: RunSummary = {
        run: input.run,
        started,
        finished: final ? deps.now().toISOString() : null,
        status: stopReason || capReason ? "stopped" : final ? "finished" : "running",
        ...(stopReason || capReason ? { stopped_reason: (stopReason ?? capReason)! } : {}),
        done,
        total,
        ...counts,
        tripped: circuitBreaker({ attempted: counts.attempted, failed: counts.failed, changed: counts.changed, priorValues }),
        usage: structuredClone(usage),
      };
      return {
        sources: { updated: today, recipes: [...recipes.values()] },
        // `updated` on the published file moves only when something published, so a quiet run leaves it untouched.
        reported: { updated: counts.published ? today : input.reported.updated, entries: [...entries.values()] },
        queue: { updated: today, items: [...items] },
        summary,
      };
    }

    const queue = [...input.schools];
    const workers = Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, async () => {
      for (let s = queue.shift(); s && !stopped() && !capReached(); s = queue.shift()) {
        try {
          await processCollege(s);
        } catch (err) {
          log(`${s.name}: ${err instanceof Error ? err.stack : err}`);
          if (!stopped()) {
            counts.attempted++;
            counts.failed++;
          }
        }
        if (stopped()) break;
        done++;
        log(`[${done}/${total}] ${s.name} done · run cost so far ~$${totalCost().toFixed(2)}`);
        deps.onProgress?.(snapshot(false));
      }
    });
    await Promise.all(workers);
    return snapshot(true);
  }

  return { run };
}

/** Loads a JSON file (used by the CLI for schools.json and the pilot list). */
export const readJsonFile = <T,>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
