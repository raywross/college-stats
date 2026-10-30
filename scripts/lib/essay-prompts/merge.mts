/**
 * Applying the essay prompts records (data/essay-prompts/records/) and the hand-read records
 * (data/essay-prompts/confirmed/) to the dataset (specs/product/essays/prompts.md "Store"; sources.md "The hand read"):
 * `school.essays` on every college with a current record, placed before the later keys the way the Coalition block is
 * (scripts/lib/coalition/merge.mts), with one lineage record at `lineage.essays`; removed from a college whose record is
 * gone or whose cycle has closed. Both cite the college's own words (source `college-site`), which needs no meta
 * source, so meta is untouched. `npm run merge-essay-prompts` and `sync-data` both call `applyEssays`, so the two can't
 * disagree. Pure.
 *
 * Precedence per college (the hand-read brief): a reader record with `status: "published"` wins (the college's own
 * page); otherwise a hand-read record applies, beating the reader's `refers_to_form`, `none`, a held read, and no read
 * at all (the form is the truth for what the form asks). A hand-read record whose cycle isn't the open one is skipped
 * and counted.
 */
import type { LineageRecord, PlatformPrompts, PlatformPromptsFile, School, SchoolEssays } from "../../../lib/types.ts";
import { confirmedBlock, noneSentence, platformHomepage, validateConfirmed, type ConfirmedRecord } from "../../../lib/essay-prompts/confirmed.ts";
import { cycleStart, openCycle } from "./cycle.mts";
import { LIMIT_RANGE, PROMPT_CHARS } from "./checks.mts";
import type { EssayRecord } from "./store.mts";

/**
 * Top-level keys later pipelines own: a new `essays` goes right before the first of them. `selectivity` is here
 * because the tiers build (scripts/lib/selectivity.mts placeSelectivity) re-inserts its key right before `directories`
 * on every rebuild; the two blocks can only both be stable if `essays` sits before it.
 */
const LATER_KEYS = ["selectivity", "directories", "lineage", "trends", "reported"];

/** A record either reader wrote: the reader's page record, or a person's read of the form. */
export type AnyEssayRecord = EssayRecord | ConfirmedRecord;

/** Whether a record is a hand read (data/essay-prompts/confirmed/). */
export const isConfirmed = (r: AnyEssayRecord): r is ConfirmedRecord => (r as ConfirmedRecord).confidence === "confirmed";

/**
 * The block a record puts on its college. A hand read cites the platform's homepage (`platformHomepage`; for the
 * college's own form, its apply page from `school.links`), was retrieved on the day it was read, and carries
 * `confidence`, `form`, `read_on`, and `reader` after the prompts; a reader record carries none of them.
 */
export function blockOf(r: AnyEssayRecord, school?: Pick<School, "links"> | null): SchoolEssays {
  // A hand read: the same block the advisor's live overlay builds (lib/essay-prompts/confirmed.ts confirmedBlock).
  // applyEssays skips (and counts) a record with no page to cite before it gets here.
  if (isConfirmed(r)) {
    const block = confirmedBlock(r, school);
    if (!block) throw new Error(`essays: hand-read record ${r.unit_id} has no page to cite (form "own" with no apply page)`);
    return block;
  }
  const published = r.status === "published";
  return {
    cycle: r.cycle,
    status: r.status,
    source_url: r.source_url,
    retrieved: r.retrieved,
    ...(published && r.choose ? { choose: r.choose } : {}),
    prompts: published ? r.prompts : [],
  };
}

/**
 * The one lineage record that cites every `essays.*` path. A reader record: the page, the cycle as its year, its own
 * cycle line; a page that names no cycle (`cycle_assumed`) has no cycle line, so the quote is the page's sentence the
 * prompts were read from (the first prompt's, or the sentence that says there are none): an extracted record always
 * carries its words. A hand read (the brief's "Lineage for a confirmed block"): source `college-site` (the words are
 * the college's own, published in its application), method `reported` (a person read and entered them, nothing was
 * extracted from a fetched page), the platform's homepage, the day read, and the first prompt (or, for none, the
 * sentence saying the form asks nothing more) as the quote.
 */
export function lineageOf(r: AnyEssayRecord, school?: Pick<School, "links"> | null): LineageRecord {
  if (isConfirmed(r)) {
    const quote = r.status === "published" ? (r.prompts[0]?.text ?? "") : noneSentence(r.form);
    return { source: "college-site", method: "reported", year: r.cycle, url: platformHomepage(r.form, school, r.note) ?? "", retrieved: r.read_on, quote };
  }
  const quote = r.cycle_quote || r.status_quote || r.prompts[0]?.quote || "";
  return { source: "college-site", method: "extracted", year: r.cycle, url: r.source_url, retrieved: r.retrieved, quote };
}

function placeKey(school: School, key: string, value: unknown, anchors: readonly string[]): School {
  const entries = Object.entries(school);
  if (key in school) return Object.fromEntries(entries.map(([k, v]) => [k, k === key ? value : v])) as unknown as School;
  let at = entries.findIndex(([k]) => anchors.includes(k));
  if (at < 0) at = entries.length;
  return Object.fromEntries([...entries.slice(0, at), [key, value], ...entries.slice(at)]) as unknown as School;
}

/**
 * The lineage object with the essays record in its settled place: before the first `reported.*` record (at the end
 * when there is none). The college-reported merge strips and re-appends its own records last, so a record left after
 * them would move on the next re-merge and `data/schools.json` would never be stable (tests/merge-reported). Moving a
 * record already there to the same place is a no-op, so applying twice changes nothing.
 */
export function placeEssaysLineage(lineage: NonNullable<School["lineage"]>, record: LineageRecord): NonNullable<School["lineage"]> {
  const entries = Object.entries(lineage).filter(([k]) => k !== "essays");
  let at = entries.findIndex(([k]) => k.startsWith("reported."));
  if (at < 0) at = entries.length;
  return Object.fromEntries([...entries.slice(0, at), ["essays", record], ...entries.slice(at)]);
}

/** Sets the block and its lineage record, keeping each one's place when it was already there. */
export function placeEssays(school: School, r: AnyEssayRecord): School {
  // Always re-place the block (never keep an old position): the settled spot is right before the first later key.
  const { essays: _old, ...rest } = school;
  void _old;
  const withBlock = placeKey(rest as School, "essays", blockOf(r, school), LATER_KEYS);
  // `lineage` itself goes before trends and reported when the college had none (lib/identity.ts placeTopLevel).
  return placeKey(withBlock, "lineage", placeEssaysLineage(school.lineage ?? {}, lineageOf(r, school)), ["trends", "reported"]);
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
  /** Colleges whose block is a hand read (counted in published or none too). */
  confirmed: number;
  /** Hand-read records outranked by the reader's published record for the same college. */
  confirmedOutranked: number;
  /** Hand-read records skipped: a cycle other than the open one, or (own form) no page to cite. */
  confirmedSkipped: number;
  /** Hand-read records for a unit id the dataset doesn't hold. */
  confirmedUnjoined: number;
}

/**
 * The block on every college with a current record, none on anyone else. `today` decides the open cycle. `confirmed`:
 * the hand-read records, applied per the precedence in the header.
 */
export function applyEssays(
  schools: readonly School[],
  records: readonly EssayRecord[],
  today: string,
  confirmed: readonly ConfirmedRecord[] = [],
): { schools: School[]; summary: EssaysSummary } {
  const openName = openCycle(today);
  const open = cycleStart(openName)!;
  const summary: EssaysSummary = { colleges: 0, published: 0, none: 0, refersToForm: 0, prompts: 0, removed: 0, stale: 0, unjoined: 0, confirmed: 0, confirmedOutranked: 0, confirmedSkipped: 0, confirmedUnjoined: 0 };
  const byId = new Map(schools.map((s) => [s.unit_id, s]));
  const current = new Map<string, AnyEssayRecord>();
  for (const r of records) {
    if (!byId.has(r.unit_id)) {
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
  for (const c of confirmed) {
    const school = byId.get(c.unit_id);
    if (!school) {
      summary.confirmedUnjoined++;
      continue;
    }
    // Only the open cycle: a hand read is of this year's form; last year's is closed, and next year's can't be read yet.
    if (c.cycle !== openName || !platformHomepage(c.form, school, c.note)) {
      summary.confirmedSkipped++;
      continue;
    }
    if (current.get(c.unit_id)?.status === "published") {
      summary.confirmedOutranked++;
      continue;
    }
    current.set(c.unit_id, c);
  }
  const out = schools.map((s) => {
    const r = current.get(s.unit_id);
    if (!r) {
      if (s.essays) summary.removed++;
      return stripEssays(s);
    }
    summary.colleges++;
    if (isConfirmed(r)) summary.confirmed++;
    if (r.status === "published") summary.published++;
    else if (r.status === "none") summary.none++;
    else summary.refersToForm++;
    summary.prompts += r.status === "published" ? r.prompts.length : 0;
    return placeEssays(s, r);
  });
  return { schools: out, summary };
}

/**
 * Problems with the hand-read records on disk (empty when every one passes lib/essay-prompts/confirmed.ts
 * `validateConfirmed`): the console checks before it opens a pull request, and this catches a file edited by hand.
 * Both scripts refuse to write while any remain.
 */
export function confirmedProblems(records: readonly ConfirmedRecord[], today: string): string[] {
  return records.flatMap((r) => validateConfirmed(r, today).map((p) => `confirmed/${r.unit_id}.json: ${p}`));
}

export function summaryLine(s: EssaysSummary): string {
  const extra = [
    s.confirmedOutranked ? `${s.confirmedOutranked} outranked by the college's page` : "",
    s.confirmedSkipped ? `${s.confirmedSkipped} hand-read skipped (not the open cycle, or no page to cite)` : "",
    s.confirmedUnjoined ? `${s.confirmedUnjoined} hand-read unjoined` : "",
  ].filter(Boolean);
  const hand = `${s.confirmed} read from the form by hand${extra.length ? `, ${extra.join(", ")}` : ""}`;
  return `${s.colleges} colleges (${s.published} published, ${s.none} with none, ${s.refersToForm} pointing to the form; ${s.prompts} prompts; ${hand}), ${s.removed} removed, ${s.stale} closed-cycle records skipped, ${s.unjoined} unjoined`;
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
