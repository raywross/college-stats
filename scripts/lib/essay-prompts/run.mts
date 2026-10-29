/**
 * One college through the essay prompts route (specs/product/essays/prompts.md "Sources"): find the page
 * (./discover.mts), skip it when its bytes are the ones already read, keep it in the archive by sha, read it once
 * (./read.mts), check the record (./checks.mts). Everything outside is injected, so tests run it on fixture pages with
 * a fake client and no network.
 */
import type { School } from "../../../lib/types.ts";
import type { Archive } from "../college-reported/archive.mts";
import { sha256 } from "../college-reported/http.mts";
import type { ModelClient } from "../college-reported/models.mts";
import { SpendCapReached, type SpendCap } from "../high-schools/profiles/budget.mts";
import { checkRecord } from "./checks.mts";
import { discoverEssayPage, type DiscoverHttp, type FoundPage } from "./discover.mts";
import { ReadFailed, pageText, readEssayPage, toRecord, type ReadAnswer } from "./read.mts";
import { READER_VERSION, type EssayRecord, type PageRecipe } from "./store.mts";

export interface RunDeps {
  http: DiscoverHttp;
  client?: ModelClient;
  cap: SpendCap;
  archive?: Archive;
  today: string;
  log?: (m: string) => void;
  /** Re-read a page whose bytes haven't changed. */
  force?: boolean;
  /** Find pages only; no model read (free apart from the picker, which needs a client). */
  discoverOnly?: boolean;
  /** The platforms' own prompt texts, for the check that a college prompt isn't one of them. */
  platformTexts?: readonly string[];
  /**
   * Reads shared across the run, by the page's sha: the nine UC campuses share one personal insight questions page, and
   * one read of it serves them all (and agrees with itself).
   */
  readCache?: Map<string, { answer: ReadAnswer; model: string }>;
}

export type Outcome =
  | { kind: "not-found"; recipe: PageRecipe; cost: number }
  | { kind: "found"; recipe: PageRecipe; cost: number }
  | { kind: "unchanged"; recipe: PageRecipe; cost: number }
  | { kind: "passed"; recipe: PageRecipe; record: EssayRecord; cost: number }
  | { kind: "held"; recipe: PageRecipe; record: EssayRecord; problems: string[]; cost: number }
  | { kind: "failed"; recipe: PageRecipe; reason: string; cost: number };

const samePrompts = (a: EssayRecord, b: EssayRecord) => JSON.stringify(a.prompts.map((p) => [p.text, p.limit, p.required])) === JSON.stringify(b.prompts.map((p) => [p.text, p.limit, p.required]));

/** Runs one college. Throws only SpendCapReached (the run stops there); every other failure is an outcome. */
export async function runCollege(school: Pick<School, "unit_id" | "name" | "links">, recipe: PageRecipe | undefined, prior: EssayRecord | null, deps: RunDeps): Promise<Outcome> {
  const log = deps.log ?? (() => {});
  // A conditional GET only when there is a record to stand for a 304. A record that lists no prompts (none,
  // refers_to_form) may have come from a general page the ladder settled for; discovery starts over for it each run,
  // so a better page can still be found (the same page again costs no read: its bytes are unchanged).
  const settled = prior?.status === "published";
  const ask = recipe && prior && settled ? recipe : recipe && settled ? { ...recipe, etag: undefined, last_modified: undefined } : undefined;
  const found = await discoverEssayPage(school, ask, { http: deps.http, client: deps.client, cap: deps.cap, log });
  let cost = found.cost;
  if (!found.found) {
    return { kind: "not-found", cost, recipe: { url: null, via: null, checked: deps.today, tried: found.tried.slice(0, 10), ...(found.blocked ? { blocked: found.blocked } : {}) } };
  }
  const page = found.found;
  const base: PageRecipe = {
    url: page.url,
    via: page.via === "recipe" ? (recipe?.via ?? "recipe") : page.via,
    checked: deps.today,
    ...(page.etag ? { etag: page.etag } : {}),
    ...(page.last_modified ? { last_modified: page.last_modified } : {}),
  };
  if (page.unchanged && prior) return { kind: "unchanged", cost, recipe: { ...base, sha256: prior.sha256 } };
  const sha = sha256(page.bytes);
  const next: PageRecipe = { ...base, sha256: sha };
  if (!deps.force && prior && prior.sha256 === sha && prior.reader === READER_VERSION) return { kind: "unchanged", cost, recipe: next };
  const archive = deps.archive ? await deps.archive.put(sha, page.bytes, page.format) : undefined;
  if (deps.discoverOnly || !deps.client) return { kind: "found", cost, recipe: next };

  const client = deps.client;
  /** One model read per page per run: a page already read this run (the UC's shared page) is answered from the cache. */
  const readPage = async (key: string, url: string, text: string) => {
    const hit = deps.readCache?.get(key);
    if (hit) return { answer: hit.answer, model: hit.model, cost: 0 };
    const r = await readEssayPage(client, deps.cap, { school, url, text });
    deps.readCache?.set(key, { answer: r.answer, model: r.model });
    return r;
  };
  const judge = (answer: ReadAnswer, model: string, p: FoundPage, pageSha: string, pageArchive: string | undefined, pageRecipe: PageRecipe, text: string) => {
    const record = toRecord(answer, { school, url: p.url, final_url: p.final_url, retrieved: deps.today, sha256: pageSha, archive: pageArchive, via: pageRecipe.via ?? p.via, model });
    if (prior) {
      if (prior.cycle !== record.cycle && prior.status === "published" && !samePrompts(prior, record)) {
        record.previous = { cycle: prior.cycle, source_url: prior.source_url, retrieved: prior.retrieved, prompts: prior.prompts };
      } else if (prior.previous && prior.previous.cycle !== record.cycle) record.previous = prior.previous;
    }
    const problems = checkRecord(record, { today: deps.today, pageText: text, platformTexts: deps.platformTexts });
    return { record, problems };
  };

  const text = await pageText(page.bytes, page.format);
  let read;
  try {
    read = await readPage(sha, page.final_url, text);
  } catch (err) {
    if (err instanceof SpendCapReached) throw err;
    const reason = err instanceof ReadFailed ? err.reason : err instanceof Error ? err.message : String(err);
    log(`  ${school.name}: read failed (${reason})`);
    return { kind: "failed", cost, recipe: next, reason };
  }
  cost += read.cost;
  const { record, problems } = judge(read.answer, read.model, page, sha, archive, next, text);

  // A second look. A general "how to apply" page says the essays are in the form while the college's own prompts page
  // sits one link away (Cornell, Dartmouth, Tufts in the first runs). When the first read lists no prompts, the ladder
  // runs once more past that page; a page that reads as published replaces the first answer.
  if (record.status !== "published") {
    const again = await discoverEssayPage(school, undefined, { http: deps.http, client, cap: deps.cap, log, skip: [page.url, page.final_url] });
    cost += again.cost;
    const alt = again.found;
    if (alt && !alt.unchanged) {
      const altSha = sha256(alt.bytes);
      if (altSha !== sha) {
        try {
          const altArchive = deps.archive ? await deps.archive.put(altSha, alt.bytes, alt.format) : undefined;
          const altText = await pageText(alt.bytes, alt.format);
          const altRead = await readPage(altSha, alt.final_url, altText);
          cost += altRead.cost;
          const altRecipe: PageRecipe = { url: alt.url, via: alt.via, checked: deps.today, sha256: altSha, ...(alt.etag ? { etag: alt.etag } : {}), ...(alt.last_modified ? { last_modified: alt.last_modified } : {}) };
          const second = judge(altRead.answer, altRead.model, alt, altSha, altArchive, altRecipe, altText);
          if (second.record.status === "published") {
            log(`  ${school.name}: the second look found the prompts at ${alt.url}`);
            return second.problems.length
              ? { kind: "held", cost, recipe: altRecipe, record: second.record, problems: second.problems }
              : { kind: "passed", cost, recipe: altRecipe, record: second.record };
          }
        } catch (err) {
          if (err instanceof SpendCapReached) throw err;
          log(`  ${school.name}: the second look's read failed (${err instanceof ReadFailed ? err.reason : err instanceof Error ? err.message : String(err)})`);
        }
      }
    }
  }
  return problems.length ? { kind: "held", cost, recipe: next, record, problems } : { kind: "passed", cost, recipe: next, record };
}
