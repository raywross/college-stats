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
 * Per college: discovery when there's no recipe (or --rediscover) → re-check index pages for new links → fetch each
 * source conditionally (304 or same hash = skip the model) → read changed documents (Excel CDS deterministically, PDF
 * and HTML with the extraction model) → checks → publish, or escalate (re-discover with Sonnet, then one Opus try) →
 * review queue.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CIRCUIT_BREAKER,
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
}

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
  | { state: "skipped"; detail: string }
  | { state: "problem"; detail: string };

type Outcome =
  | { status: "unchanged" }
  | { status: "skipped"; reason: string }
  | { status: "stale"; reason: string }
  | { status: "published"; entry: ReportedEntry }
  | { status: "failed"; failures: CheckFailure[]; extraction: Extraction | null; urls: string[] };

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
    const ctx: LlmContext = { client: deps.client, usage, today, log };
    const maxDiscoveries = input.maxDiscoveries ?? 100;
    const counts = { attempted: 0, documents_read: 0, published: 0, changed: 0, failed: 0, discovered: 0, escalated: 0 };

    const recipes = new Map(input.sources.recipes.map((r) => [r.unit_id, r]));
    const entries = new Map(input.reported.entries.map((e) => [e.unit_id, e]));
    const priorValues = input.reported.entries.reduce((n, e) => n + countValues(e), 0);
    let items = [...input.queue.items];

    /* ---------------- one document ---------------- */

    async function readSource(school: School, src: RecipeSource, o: { force: boolean; model: string; job: Job }): Promise<SourceRead> {
      const conditional = !o.force && src.sha256 ? { etag: src.etag, last_modified: src.last_modified } : {};
      let res: Response | null;
      try {
        res = await http.get(src.url, conditional);
      } catch (err) {
        return { state: "problem", detail: `${src.url}: ${err instanceof Error ? err.message : err}` };
      }
      if (!res) return { state: "skipped", detail: `robots.txt disallows ${src.url}` };
      if (res.status === 304) return { state: "unchanged" };
      if (isBlocked(res)) {
        log(`  ${src.url}: HTTP ${res.status} (bot protection or rate limit); not retried`);
        return { state: "skipped", detail: `HTTP ${res.status} at ${src.url}` };
      }
      if (!res.ok) return { state: "problem", detail: `HTTP ${res.status} at ${src.url}` };
      const bytes = new Uint8Array(await res.arrayBuffer());
      const hash = sha256(bytes);
      const etag = res.headers.get("etag") ?? undefined;
      const lastModified = res.headers.get("last-modified") ?? undefined;
      if (!o.force && hash === src.sha256) {
        src.etag = etag ?? src.etag;
        src.last_modified = lastModified ?? src.last_modified;
        return { state: "unchanged" };
      }
      const file = cacheDocument(cacheDir, hash, bytes);
      const format = detectFormat(bytes, res.headers.get("content-type"), src.url);
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
      if (etag) src.etag = etag;
      else delete src.etag;
      if (lastModified) src.last_modified = lastModified;
      else delete src.last_modified;
      return { state: "read" };
    }

    async function readDocument(
      school: School,
      src: RecipeSource,
      doc: { file: string; bytes: Uint8Array; format: RecipeSource["format"] },
      o: { model: string; job: Job }
    ): Promise<{ extraction: Extraction } | { problem: string }> {
      const ask = (d: Omit<DocumentInput, "kind" | "url">) => extract(ctx, school, { kind: src.kind, url: src.url, ...d }, o);
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
        return { extraction: await ask({ text: windowAround(text, src.anchor ?? "C1") }) };
      }
      if (doc.format === "pdf") {
        const pages = await pdfPages(doc.bytes);
        const chars = pages.reduce((n, p) => n + p.trim().length, 0);
        if (chars < SCANNED_TEXT_CHARS) {
          if (pages.length > 100) return { problem: `${src.url}: scanned PDF of ${pages.length} pages is too long to send` };
          return { extraction: await ask({ pdfBase64: Buffer.from(doc.bytes).toString("base64") }) };
        }
        const which = selectPages(pages, src.pages, src.anchor);
        if (!which.length) return { problem: `anchor "${src.anchor ?? ""}" not found in ${src.url}` };
        return { extraction: await ask({ text: pagesText(pages, which) }) };
      }
      const text = htmlToText(new TextDecoder().decode(doc.bytes));
      if (src.anchor && !text.toLowerCase().includes(src.anchor.toLowerCase())) return { problem: `anchor "${src.anchor}" not found in ${src.url}` };
      return { extraction: await ask({ text: windowAround(text, src.anchor) }) };
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
      const reads = await Promise.all(recipe.sources.map((s) => readSource(school, s, o)));
      const problems = reads.flatMap((r) => (r.state === "problem" ? [r.detail] : []));
      for (const r of reads) if (r.state === "skipped" || r.state === "problem") log(`  ${school.name}: ${r.detail}`);
      if (!reads.some((r) => r.state === "read") && !problems.length) {
        return reads.some((r) => r.state === "unchanged") ? { status: "unchanged" } : { status: "skipped", reason: "no source could be fetched" };
      }

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
      return { status: "failed", failures, extraction: worst?.e ?? null, urls: worst ? [worst.src.url] : recipe.sources.map((s) => s.url) };
    }

    /* ---------------- one college ---------------- */

    let discoveries = 0;
    const canDiscover = () => discoveries < maxDiscoveries;

    async function learn(school: School, old: Recipe | undefined, model: string, job: Job): Promise<Recipe | null> {
      if (job === "discovery") {
        discoveries++;
        counts.discovered++;
      }
      try {
        const fresh = await discover(ctx, school, { model, job });
        log(`  ${school.name}: ${model} found ${fresh.sources.length} source(s)${fresh.none_found ? " (none newer)" : ""}`);
        return carryState(fresh, old);
      } catch (err) {
        log(`  ${school.name}: discovery with ${model} failed: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }

    async function processCollege(school: School): Promise<void> {
      const stored = recipes.get(school.unit_id);
      let recipe = stored ? structuredClone(stored) : undefined;
      let discoveredNow = false;
      if (!recipe || input.rediscover) {
        if (!canDiscover()) {
          if (!recipe) return void log(`${school.name}: no recipe and the discovery budget is spent; skipped`);
        } else {
          const fresh = await learn(school, recipe, REPORTED_MODELS.discovery, "discovery");
          if (fresh) {
            recipe = fresh;
            discoveredNow = true;
          } else if (!recipe) {
            counts.attempted++;
            return;
          }
        }
      }
      if (recipe!.none_found) {
        if (discoveredNow) counts.attempted++;
        recipes.set(school.unit_id, recipe!);
        return void log(`${school.name}: nothing newer published${discoveredNow ? "" : " (per recipe; re-checked on --rediscover)"}`);
      }

      let current = recipe!;
      let out = await attempt(school, current, { force: false, model: REPORTED_MODELS.extraction, job: "extraction" });
      if (out.status === "failed") {
        counts.escalated++;
        log(`${school.name}: checks failed (${out.failures.map((f) => f.check).join(", ")}); escalating`);
        if (!discoveredNow && canDiscover()) {
          const again = await learn(school, current, REPORTED_MODELS.discovery, "discovery");
          if (again && !again.none_found) {
            const retry = await attempt(school, again, { force: true, model: REPORTED_MODELS.extraction, job: "extraction" });
            current = again;
            out = retry;
          }
        }
        if (out.status === "failed") {
          const last = await learn(school, current, REPORTED_MODELS.escalation, "escalation");
          if (last && !last.none_found) {
            const retry = await attempt(school, last, { force: true, model: REPORTED_MODELS.escalation, job: "escalation" });
            current = last;
            out = retry;
          }
        }
      }
      recipes.set(school.unit_id, current);

      if (out.status === "unchanged" || out.status === "skipped") {
        if (discoveredNow) counts.attempted++;
        return void log(`${school.name}: ${out.status === "unchanged" ? "unchanged" : out.reason}`);
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
      counts.failed++;
      const item: ReviewItem = {
        unit_id: school.unit_id,
        name: school.name,
        urls: out.urls,
        entering_term: out.extraction?.entering_term ?? null,
        extraction: out.extraction ?? { cohort: "unknown", scope: "unknown", entering_term: null, applicants: null, admitted: null, enrolled: null, acceptance_rate: null, quotes: {}, page: null },
        failures: out.failures,
        queued: today,
        run: input.run,
      };
      items = [...items.filter((i) => i.unit_id !== school.unit_id), item];
      log(`${school.name}: to the review queue (${out.failures.map((f) => `${f.check}: ${f.detail}`).join("; ")})`);
    }

    /* ---------------- all colleges ---------------- */

    const queue = [...input.schools];
    const workers = Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          await processCollege(s);
        } catch (err) {
          log(`${s.name}: ${err instanceof Error ? err.stack : err}`);
          counts.attempted++;
          counts.failed++;
        }
      }
    });
    await Promise.all(workers);

    const summary: RunSummary = {
      run: input.run,
      started,
      finished: deps.now().toISOString(),
      ...counts,
      tripped: circuitBreaker({ attempted: counts.attempted, failed: counts.failed, changed: counts.changed, priorValues }),
      usage,
    };
    return {
      sources: { updated: today, recipes: [...recipes.values()] },
      // `updated` on the published file moves only when something published, so a quiet run leaves it untouched.
      reported: { updated: counts.published ? today : input.reported.updated, entries: [...entries.values()] },
      queue: { updated: today, items },
      summary,
    };
  }

  return { run };
}

/** Loads a JSON file (used by the CLI for schools.json and the pilot list). */
export const readJsonFile = <T,>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
