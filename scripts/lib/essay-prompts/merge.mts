/**
 * Applying the essay prompts records (data/essay-prompts/records/) to the dataset (specs/product/essays/prompts.md
 * "Store"): `school.essays` on every college with a current record, placed before the later keys the way the
 * Coalition block is (scripts/lib/coalition/merge.mts), with one lineage record at `lineage.essays` citing the page;
 * removed from a college whose record is gone or whose cycle has closed. The page is the college's own site
 * (source `college-site`), which needs no meta source, so meta is untouched. `npm run merge-essay-prompts` and
 * `sync-data` both call `applyEssays`, so the two can't disagree. Pure.
 */
import type { LineageRecord, PlatformPrompts, PlatformPromptsFile, School, SchoolEssays } from "../../../lib/types.ts";
import { cycleStart, openCycle } from "./cycle.mts";
import { LIMIT_RANGE, PROMPT_CHARS } from "./checks.mts";
import type { EssayRecord } from "./store.mts";

/** Top-level keys later pipelines own (lib/identity.ts LATER_KEYS): a new `essays` goes right before the first of them. */
const LATER_KEYS = ["directories", "lineage", "trends", "reported"];

/** The block a record puts on its college. */
export function blockOf(r: EssayRecord): SchoolEssays {
  return { cycle: r.cycle, status: r.status, source_url: r.source_url, retrieved: r.retrieved, prompts: r.status === "published" ? r.prompts : [] };
}

/** The one lineage record that cites every `essays.*` path: the page, the cycle as its year, its own cycle line. */
export function lineageOf(r: EssayRecord): LineageRecord {
  return { source: "college-site", method: "extracted", year: r.cycle, url: r.source_url, retrieved: r.retrieved, quote: r.cycle_quote };
}

function placeKey(school: School, key: string, value: unknown, anchors: readonly string[]): School {
  const entries = Object.entries(school);
  if (key in school) return Object.fromEntries(entries.map(([k, v]) => [k, k === key ? value : v])) as unknown as School;
  let at = entries.findIndex(([k]) => anchors.includes(k));
  if (at < 0) at = entries.length;
  return Object.fromEntries([...entries.slice(0, at), [key, value], ...entries.slice(at)]) as unknown as School;
}

/** Sets the block and its lineage record, keeping each one's place when it was already there. */
export function placeEssays(school: School, r: EssayRecord): School {
  const withBlock = placeKey(school, "essays", blockOf(r), LATER_KEYS);
  // `lineage` itself goes before trends and reported when the college had none (lib/identity.ts placeTopLevel).
  return placeKey(withBlock, "lineage", { ...(school.lineage ?? {}), essays: lineageOf(r) }, ["trends", "reported"]);
}

/** The college without the block or its lineage record; a lineage left empty is dropped. */
export function stripEssays(school: School): School {
  if (!school.essays && !school.lineage?.essays) return school;
  const { essays: _block, ...rest } = school;
  void _block;
  const out = rest as School;
  if (out.lineage) {
    const { essays: _rec, ...lineage } = out.lineage;
    void _rec;
    if (Object.keys(lineage).length) out.lineage = lineage;
    else delete out.lineage;
  }
  return out;
}

export interface EssaysSummary {
  /** Colleges that carry a block after the merge. */
  colleges: number;
  published: number;
  none: number;
  refersToForm: number;
  prompts: number;
  /** Colleges whose block was taken off (no record now, or a closed cycle). */
  removed: number;
  /** Records skipped because their cycle closed (older than the open one). */
  stale: number;
  /** Records for a unit id the dataset doesn't hold. */
  unjoined: number;
}

/** The block on every college with a current record, none on anyone else. `today` decides the open cycle. */
export function applyEssays(schools: readonly School[], records: readonly EssayRecord[], today: string): { schools: School[]; summary: EssaysSummary } {
  const open = cycleStart(openCycle(today))!;
  const summary: EssaysSummary = { colleges: 0, published: 0, none: 0, refersToForm: 0, prompts: 0, removed: 0, stale: 0, unjoined: 0 };
  const ids = new Set(schools.map((s) => s.unit_id));
  const current = new Map<string, EssayRecord>();
  for (const r of records) {
    if (!ids.has(r.unit_id)) {
      summary.unjoined++;
      continue;
    }
    const start = cycleStart(r.cycle);
    if (start === null || start < open) {
      summary.stale++;
      continue;
    }
    current.set(r.unit_id, r);
  }
  const out = schools.map((s) => {
    const r = current.get(s.unit_id);
    if (!r) {
      if (s.essays) summary.removed++;
      return stripEssays(s);
    }
    summary.colleges++;
    if (r.status === "published") summary.published++;
    else if (r.status === "none") summary.none++;
    else summary.refersToForm++;
    summary.prompts += blockOf(r).prompts.length;
    return placeEssays(s, r);
  });
  return { schools: out, summary };
}

export function summaryLine(s: EssaysSummary): string {
  return `${s.colleges} colleges (${s.published} published, ${s.none} with none, ${s.refersToForm} pointing to the form; ${s.prompts} prompts), ${s.removed} removed, ${s.stale} closed-cycle records skipped, ${s.unjoined} unjoined`;
}

/* ------------------------------------------------------------------ */
/* data/reference/platform-prompts.json                                */
/* ------------------------------------------------------------------ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with the platform prompts file (empty when it is sound): every field present, ids in order, prompts in range. */
export function platformProblems(file: PlatformPromptsFile | null): string[] {
  if (!file) return ["data/reference/platform-prompts.json is missing"];
  const out: string[] = [];
  for (const key of ["common_app", "coalition"] as const) {
    const p = file[key] as PlatformPrompts | undefined;
    const where = `platform-prompts ${key}`;
    if (!p) {
      out.push(`${where}: missing`);
      continue;
    }
    if (cycleStart(p.cycle) === null) out.push(`${where}: cycle ${JSON.stringify(p.cycle)} isn't "YYYY-YY"`);
    if (!p.cycle_quote && !p.cycle_note) out.push(`${where}: no cycle_quote, and no cycle_note saying why`);
    if (!/^https:\/\/[^/]+\/?$/.test(p.source_url)) out.push(`${where}: source_url must be the organization's homepage`);
    if (!/^https:\/\//.test(p.read_from)) out.push(`${where}: read_from must be the page read`);
    if (!ISO.test(p.retrieved)) out.push(`${where}: retrieved isn't an ISO date`);
    if (p.limit && !p.limit_quote) out.push(`${where}: a limit without the sentence it was read from`);
    if (!p.limit && !p.limit_note) out.push(`${where}: no limit, and no limit_note saying the page prints none`);
    if (!p.prompts?.length) out.push(`${where}: no prompts`);
    (p.prompts ?? []).forEach((q, i) => {
      if (q.id !== `platform:${key}:${i + 1}`) out.push(`${where}: prompt ${i + 1} id ${q.id} isn't platform:${key}:${i + 1}`);
      if (!q.text || q.text.length < PROMPT_CHARS.min || q.text.length > PROMPT_CHARS.max) out.push(`${where}: prompt ${i + 1} text is missing or out of range`);
      if (!q.quote) out.push(`${where}: prompt ${i + 1} has no quote`);
      if (q.limit) {
        const r = LIMIT_RANGE[q.limit.kind];
        if (!r || q.limit.max < r.min || q.limit.max > r.max) out.push(`${where}: prompt ${i + 1} limit out of range`);
      }
    });
  }
  return out;
}
