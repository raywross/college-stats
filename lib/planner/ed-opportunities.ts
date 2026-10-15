/**
 * ED opportunities (specs/planner/next-steps/ed-opportunities.md): the colleges on a list at Reach or Target that offer
 * early decision, ranked by the estimate's ED verdict and then the owner's order, at most three (owner 2026-10-15:
 * "be more forgiving … show up to three in the Reach or top of Target, particularly if one is a Dream"); the round
 * each pill names; the `ed_decide` and `ed2_decide` moves; and the facts the ED sheet shows (the college's own
 * numbers, never the estimate's).
 *
 * - Candidates (owner 2026-10-15, "an ED has to be viewed like a currency … you only have 1, but it's free to use"):
 *   the college offers ED (`isOffered(school, "ed") === true`), the level is Reach or Target (an Ultra selective
 *   college's capped Reach included), its ED verdict is `helps`, `improves`, or null (no counts published; never
 *   `same`, where the college's ED rate isn't above its overall rate, nor `not_advised`), the row isn't withdrawn or
 *   decided, and the student hasn't said "Not for me" (`ed_dismissed_at`). Where the verdict isn't `helps`, the
 *   college must sit at Reach or at the top of Target (closeness 0 or 1), or be the Dream. One more: the Dream at High
 *   reach, where the college's own ED rate is above its overall rate (`edRateAbove`; the model says `not_advised`
 *   there), ranked after every Reach and Target candidate ("not necessarily if it were high reach and there were some
 *   good ED reach options"). A row already in ED or ED II stays a candidate: its pill reads as confirmation.
 * - Rank: `helps`, then `improves`, then null, then the High-reach Dream; within each, the Dream; Reach at closeness
 *   3, 2; Target 0, 1; Reach 1, 0; Target 2, 3; no closeness after; then the student's own order. Closeness orders; it
 *   never shows.
 * - Round per pill: one candidate is ED (the one the student set in ED, else the first); each other is ED II when the
 *   college offers it, the student set it there, or its ED II closing falls after the ED college's ED notification
 *   (the built conflict rule, rounds.ts conflicts); else `ed_alt` ("ED is one college").
 * - Timing: nothing before junior spring, nothing without a class year; a candidate whose round has closed drops (a
 *   round with no published closing counts as open through senior fall for ED, senior winter for ED II), so the list
 *   empties once the last ED II deadline has passed.
 *
 * `ed_decide` is "ticked" by not being generated: once any row is in ED or ED II as the student's own choice
 * (`round_source === "student"`), edMoves stops emitting it and mergeTasks folds it as orphaned, which the Next
 * steps tab never shows. Pure; no I/O; safe in client components.
 */
import type { EstimateResult, StandingLevel } from "../chances/types.ts";
import { STANDING_LEVEL_LABELS, STANDING_LEVELS } from "../chances/levels.ts";
import { noteText } from "../chances/notes.ts";
import { classShareLine } from "../early.ts";
import { MOVE_TEXT } from "./moves-catalog.ts";
import { earlyFor, isOffered, lastCycleNote, roundDates, type RoundDate, type RoundsSchool } from "./rounds.ts";
import { seasonRank, type Season } from "./seasons.ts";
import { taskKey } from "./tasks.ts";
import type { GeneratedTask, GeneratorInput, PlanItem, PlanSchool } from "./types.ts";

export type EdRound = "ed" | "ed2" | "ed_alt";

export interface EdCandidate {
  itemId: string;
  unitId: string;
  round: EdRound;
  /** 1-based, in the owner's order. */
  rank: number;
  level: StandingLevel;
  dream: boolean;
  /** Always false in edOpportunities' result (dismissed rows aren't candidates); see edDismissedItemIds. */
  dismissed: boolean;
  /**
   * The estimate's ED verdict: "helps" (a level up), "improves" (the ED rate is above overall, the level holds), null
   * (ED offered, no counts published), or "not_advised" (the Dream at High reach). Wording only. Always set by
   * edOpportunities; optional so hand-built candidates (other units' tests) still type-check, and an absent one reads
   * as the plain wording. "same" is never a candidate's; it stays in the type for hand-built ones.
   */
  verdict?: EdVerdict;
}

export type EdVerdict = EstimateResult["ed"];

/** What a candidate is read from: a list row. */
export type EdRow = Pick<PlanItem, "id" | "unit_id" | "round" | "dream" | "status" | "withdrawn_on" | "position"> &
  Partial<Pick<PlanItem, "ed_dismissed_at" | "ed_checks" | "round_source" | "outcome" | "decision_date">>;

/**
 * The first season with pills (ed-opportunities.md "Moves and timing"): junior fall since 2026-10-15 (owner: a junior
 * with a Dream that offers ED should see the chip as soon as the list is real; it was junior spring).
 */
export const ED_FIRST_SEASON: Season = "junior_fall";
/** The first season with the `ed_decide` move and the per-candidate cost checks. */
export const ED_DECIDE_SEASON: Season = "summer_before_senior";

/** The pill's words at `helps` (EdPill.tsx): the full text, and the short one on a phone. */
export const ED_PILL_TEXT: Record<EdRound, { full: string; short: string }> = {
  ed: { full: "Good ED opportunity", short: "ED" },
  ed_alt: { full: "Good ED opportunity", short: "ED" },
  ed2: { full: "Good ED II opportunity", short: "ED II" },
};

/** The pill's words at `improves`, null, or the High-reach Dream (no level up, or no counts): no "Good". */
export const ED_PILL_TEXT_PLAIN: Record<EdRound, { full: string; short: string }> = {
  ed: { full: "ED opportunity", short: "ED" },
  ed_alt: { full: "ED opportunity", short: "ED" },
  ed2: { full: "ED II opportunity", short: "ED II" },
};

/** The pill's words for a round and verdict (ed-opportunities.md "The pill"). */
export const edPillText = (round: EdRound, verdict: EdVerdict | undefined) => (verdict === "helps" ? ED_PILL_TEXT : ED_PILL_TEXT_PLAIN)[round];

const isPlanned = (s: Season) => s !== "unknown" && seasonRank(s) >= seasonRank(ED_FIRST_SEASON);

/** The owner's order (ed-opportunities.md "Candidates and ranking" 2) within one verdict: lower first. */
function priority(dream: boolean, level: StandingLevel, closeness: EstimateResult["closeness"]): number {
  if (dream) return 0;
  if (closeness === null || closeness === undefined) return 9;
  if (level === "reach") return closeness === 3 ? 1 : closeness === 2 ? 2 : closeness === 1 ? 5 : 6;
  return closeness === 0 ? 3 : closeness === 1 ? 4 : closeness === 2 ? 7 : 8;
}

/** The round a pill's dates come from. */
const datesRound = (r: EdRound) => (r === "ed2" ? "ed2" : "ed");

const bySchool = (schools: Record<string, PlanSchool | RoundsSchool>, unitId: string) => (schools[unitId] ?? null) as RoundsSchool | null;

/** Whether a candidate's round still takes applications on `today` (an unpublished closing: see the module comment). */
function stillOpen(school: RoundsSchool | null, round: EdRound, season: Season, today: string): boolean {
  const closing = roundDates(school, datesRound(round)).closing;
  if (closing) return closing.iso >= today;
  return seasonRank(season) <= seasonRank(round === "ed2" ? "senior_winter" : "senior_fall");
}

/** The rows whose ED pill the student dismissed ("Not for me"), for the interest rules (U3). */
export function edDismissedItemIds(rows: readonly EdRow[]): string[] {
  return rows.filter((r) => !!r.ed_dismissed_at).map((r) => r.id);
}

const chose = (r: EdRow, round: "ed" | "ed2") => r.round === round && r.round_source === "student";

/** Verdict groups, in rank order; the High-reach Dream comes after every Reach and Target candidate. */
const VERDICT_ORDER = { helps: 0, improves: 1, none: 2, highReachDream: 3 } as const;

/**
 * Whether the college's own ED rate is above its overall rate (the same document's when it publishes totals, else the
 * overall rate), or null without the counts: the model's `M_ed > 1`. Read only for the Dream at High reach, where the
 * model's verdict is `not_advised` whatever the data (elsewhere `improves` and `same` already say it).
 */
export function edRateAbove(school: RoundsSchool | null): boolean | null {
  const ed = school?.profile?.early_decision;
  if (!ed || ed.applicants == null || ed.admitted == null || ed.applicants <= 0) return null;
  const t = school?.edTotals;
  const overall = t?.applicants && t.admitted != null ? t.admitted / t.applicants : (school?.admitRate ?? null);
  if (!overall) return null;
  return ed.admitted / ed.applicants > overall;
}

/** Ranked candidates, rounds assigned; before the closed-round filter. */
function ranked(rows: readonly EdRow[], estimates: Record<string, EstimateResult>, schools: Record<string, PlanSchool | RoundsSchool>): (EdCandidate & { row: EdRow })[] {
  const pool = rows
    .filter((r) => !r.withdrawn_on && r.status !== "decided" && !r.ed_dismissed_at)
    .flatMap((r): { row: EdRow; level: StandingLevel; verdict: EdVerdict; p: number }[] => {
      const est = estimates[r.unit_id];
      const level = est?.group ?? null;
      if (!est || !level) return [];
      const school = bySchool(schools, r.unit_id);
      if (isOffered(school, "ed") !== true) return [];
      // Owner (2026-10-15): the Dream at High reach, where the college's ED rate is above overall, ranked last.
      if (level === "high_reach") {
        if (r.dream !== true || edRateAbove(school) !== true) return [];
        return [{ row: r, level, verdict: "not_advised", p: VERDICT_ORDER.highReachDream * 10 + priority(true, level, est.closeness) }];
      }
      if (level !== "reach" && level !== "target") return [];
      const verdict: EdVerdict = est.ed ?? null;
      if (verdict === "same" || verdict === "not_advised") return [];
      // Owner (2026-10-15): where ED wouldn't move the level, the hint is still worth giving — at Reach, or at the top
      // of Target (closeness 0 or 1, nearest Reach), and always for the Dream. A `helps` verdict qualifies anywhere.
      const inBand = level === "reach" || est.closeness === 0 || est.closeness === 1;
      if (verdict !== "helps" && !r.dream && !inBand) return [];
      const p = VERDICT_ORDER[verdict ?? "none"] * 10 + priority(r.dream === true, level, est.closeness);
      return [{ row: r, level, verdict, p }];
    })
    .sort((a, b) => a.p - b.p || a.row.position - b.row.position);
  if (pool.length === 0) return [];

  // The ED college: a row already in ED (the student's pick first; it may be decided, deferred, or no candidate at
  // all), else the first candidate. Only it reads as ED; the rest are ED II or alternatives to it.
  const live = rows.filter((r) => !r.withdrawn_on);
  const inEd = live.find((r) => chose(r, "ed")) ?? live.find((r) => r.round === "ed") ?? null;
  const anchorRow = inEd ?? pool[0].row;
  const decides = roundDates(bySchool(schools, anchorRow.unit_id), "ed").notification;
  return pool.map((c, i) => {
    let round: EdRound;
    if (c.row.id === anchorRow.id) round = "ed";
    else {
      const school = bySchool(schools, c.row.unit_id);
      const ed2Closing = roundDates(school, "ed2").closing;
      const ed2 = isOffered(school, "ed2") === true && (chose(c.row, "ed2") || (!!decides && !!ed2Closing && ed2Closing.iso > decides.iso));
      round = ed2 ? "ed2" : "ed_alt";
    }
    return { row: c.row, itemId: c.row.id, unitId: c.row.unit_id, round, rank: i + 1, level: c.level, dream: c.row.dream === true, dismissed: false, verdict: c.verdict };
  });
}

/** At most this many pills (owner, 2026-10-15: "up to three in the Reach or top of Target, particularly a Dream"). */
export const ED_MAX = 3;

/**
 * The ED opportunities on a list (ed-opportunities.md "Candidates and ranking"): ranked, the first three whose round
 * is still open, empty before junior spring and once every candidate's round has closed.
 */
export function edOpportunities(
  rows: readonly EdRow[],
  estimates: Record<string, EstimateResult>,
  schools: Record<string, PlanSchool | RoundsSchool>,
  opts: { season: Season; today: string },
): EdCandidate[] {
  if (!isPlanned(opts.season)) return [];
  return ranked(rows, estimates, schools)
    .filter((c) => stillOpen(bySchool(schools, c.unitId), c.round, opts.season, opts.today))
    .slice(0, ED_MAX)
    .map(({ row, ...c }, i) => {
      void row;
      return { ...c, rank: i + 1 };
    });
}

/* ------------------------------------------------------------------ */
/* Moves                                                               */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/** The college said no to ED: denied, or deferred (recordDecision returns a deferral to applied with a decision date). */
function edSaidNo(i: PlanItem): boolean {
  if (i.round !== "ed" || i.withdrawn_on) return false;
  if (i.outcome === "denied" || i.outcome === "deferred") return true;
  return i.status === "applied" && i.outcome === null && i.decision_date !== null;
}

/**
 * The ED moves (ed-opportunities.md "Moves and timing"): `ed_decide` from the summer before senior year while no row
 * is in ED or ED II by the student's choice, due the ED college's closing; `ed2_decide` per ED II-capable candidate
 * once the ED college said no (deferred or denied), due its ED II closing.
 */
export function edMoves(input: GeneratorInput, candidates: readonly EdCandidate[]): GeneratedTask[] {
  if (input.list.student_id === null || !isPlanned(input.season)) return [];
  const out: GeneratedTask[] = [];
  const name = (unitId: string) => input.schools[unitId]?.name ?? "the college";
  const live = input.items.filter((i) => !i.withdrawn_on);

  const decidedBinding = live.some((i) => (i.round === "ed" || i.round === "ed2") && i.round_source === "student");
  const first = candidates.find((c) => c.round === "ed");
  if (!decidedBinding && first && seasonRank(input.season) >= seasonRank(ED_DECIDE_SEASON)) {
    const dates = roundDates(input.schools[first.unitId], "ed");
    const text = MOVE_TEXT.ed_decide;
    out.push({
      key: taskKey(input.list.id, "ed_decide"),
      item_id: null,
      kind: "ed_decide",
      title: dates.closing ? fill(text.title, { date: dayLabel(dates.closing.iso) }) : "Decide on ED",
      detail: text.why,
      due_on: dates.closing?.iso ?? null,
      window_start: null,
      window_end: null,
      assignee: "either",
      source: "season",
      source_field: dates.closing?.field ?? null,
      source_edition: dates.closing ? dates.edition : null,
      date_note: dates.closing && dates.lastCycle ? "last_cycle" : null,
      position: 0,
      season: input.season,
      action: { kind: "open_row", itemId: first.itemId, panel: "ed" },
    });
  }

  const edItem = live.find(edSaidNo);
  if (edItem) {
    const pickedEd2 = live.some((i) => i.id !== edItem.id && i.round === "ed2" && i.round_source === "student");
    for (const c of candidates) {
      if (c.itemId === edItem.id || pickedEd2) continue;
      const school = input.schools[c.unitId];
      if (isOffered(school, "ed2") !== true) continue;
      const dates = roundDates(school, "ed2");
      if (!dates.closing || dates.closing.iso < input.today) continue;
      const v = { edCollege: name(edItem.unit_id), college: name(c.unitId), date: dayLabel(dates.closing.iso) };
      out.push({
        key: taskKey(input.list.id, "ed2_decide", c.itemId),
        item_id: c.itemId,
        kind: "ed2_decide",
        // ed-opportunities.md's line ("{ED college} said no. ED II at {College} is due {date}.") is the title.
        title: fill(MOVE_TEXT.ed2_decide.why, v),
        detail: fill(MOVE_TEXT.ed2_decide.title, v) + ". It's binding too, and the round is yours to pick.",
        due_on: dates.closing.iso,
        window_start: null,
        window_end: null,
        assignee: "student",
        source: "season",
        source_field: dates.closing.field,
        source_edition: dates.edition,
        date_note: dates.lastCycle ? "last_cycle" : null,
        position: 0,
        season: input.season,
        action: { kind: "open_row", itemId: c.itemId, panel: "ed" },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The sheet's facts                                                   */
/* ------------------------------------------------------------------ */

export type EdCheckKey = "attend" | "cost" | "ready";
export const ED_CHECK_KEYS: readonly EdCheckKey[] = ["attend", "cost", "ready"];

/** The caveat (ed-opportunities.md "The sheet" 3), split so the glossary term wraps its middle. */
export const ED_CAVEAT = { before: "Early pools include ", term: "recruited athletes and legacies", after: ", so the edge for most applicants is smaller than the gap." } as const;

/** The owner's framing (2026-10-15, "you only have 1, but it's free to use"), under the sheet's read for every verdict. */
export const ED_FRAMING = "Early decision is one binding application; it's free to use once.";

export interface EdSheetDate extends RoundDate {
  label: string;
}

/** The ED sheet's facts: the college's own numbers, cited, plus the estimate's level only. */
export interface EdSheetFacts {
  name: string;
  unitId: string;
  round: EdRound;
  /** The level's word ("Target"), the one thing from the estimate. */
  levelLabel: string | null;
  /**
   * Quad's read by verdict: `helps` the built `ed.helps` sentence; `improves` the `ed.improves` sentence; null "hasn't
   * published how its early applicants fare"; `not_advised` (the Dream at High reach) the `ed.not_advised` sentence
   * and "still your one binding chip to spend"; `same` (never a candidate's now) "wouldn't change the level". ED II
   * adds its "though less" sentence (at null and `not_advised`, "binding too"); ED alt says ED is one college.
   */
  read: string;
  /** At `improves` (or `same`), the college's own ED rate line the read rests on (`earlyFor().line` up to its multiple, cited by `countsField`); else null. */
  readBasis: string | null;
  /** The owner's framing under every read (2026-10-15), no numbers: ED_FRAMING. */
  framing: string;
  /** "ED admitted 412 of 1,690 (24%) against 9% overall", or null without counts. */
  reported: string | null;
  /** Where the overall rate came from: "same document", or "overall rate from 2024"; null without counts. */
  lineage: string | null;
  /** The CDS edition of the counts, e.g. "2025–26". */
  edition: string | null;
  /** The field that cites the counts (school.cites[field]). */
  countsField: string;
  /** The overall rate's citation key when it isn't from the same document (school.admitRateCite). */
  overallFromAdmitRate: boolean;
  /** "about 48% of the class (if 95% of ED admits enroll)", or null. */
  share: string | null;
  /** One count pair covers both rounds: "ED I and ED II together." */
  together: boolean;
  /** "ED offered; {College} hasn't published its ED counts", when it hasn't. */
  noCounts: string | null;
  questions: { key: EdCheckKey; text: string }[];
  closing: EdSheetDate | null;
  notification: EdSheetDate | null;
  /** The last-cycle note for the dates, or null. */
  dateNote: string | null;
  /** The net price calculator, beside the cost question. */
  calculator: string | null;
  /** The college profile's "Applying early" section. */
  profileHref: string;
  profileLabel: string;
  /** The row is already in this round ("On your plan: ED"; button "Keep ED"). */
  onPlan: boolean;
}

const pct = (r: number) => `${r < 0.1 ? Math.round(r * 1000) / 10 : Math.round(r * 100)}%`;
const int = (n: number) => n.toLocaleString("en-US");

function yearOf(cite: unknown): string | null {
  const y = (cite as { year?: string | null } | null | undefined)?.year;
  return typeof y === "string" && y ? y : null;
}

/** The level one up from `level`'s word ("Target" from Reach). */
function levelAbove(level: StandingLevel | null): string | null {
  if (!level) return null;
  const up = STANDING_LEVELS[STANDING_LEVELS.indexOf(level) + 1];
  return up ? STANDING_LEVEL_LABELS[up] : null;
}

/**
 * Everything the ED sheet shows for one row and the round its pill names (default ED). Null without the college's
 * record. Every number is the college's own (CDS C21 counts, the overall rate, the dates); nothing from the estimate
 * but the level.
 */
export function edSheetFacts(row: EdRow, school: PlanSchool | undefined, estimate: EstimateResult | undefined, round: EdRound = "ed"): EdSheetFacts | null {
  if (!school) return null;
  const name = school.name;
  const early = earlyFor(school);
  const ed = school.profile?.early_decision;
  const level = estimate?.group ?? null;

  const verdict = estimate?.ed ?? null;
  let base: string;
  if (verdict === "improves") base = noteText({ key: "ed.improves", values: {} });
  else if (verdict === "same")
    base = `Early decision wouldn't change ${name}'s level for you, but ${name} admits a larger share of its early applicants, and a binding application says you'd come. Check the cost first.`;
  else if (verdict === "not_advised")
    // The Dream at High reach (owner, 2026-10-15): the guard's sentence, then the chip.
    base = `${noteText({ key: "ed.not_advised", values: {} })} If ${name} is where you'd go regardless, early decision is still your one binding chip to spend.`;
  else if (verdict === null)
    base = `${name} offers early decision but hasn't published how its early applicants fare; a binding application still says you'd come. Check the cost first.`;
  else {
    const helps = estimate?.notes.find((n) => n.key === "ed.helps");
    base = helps ? noteText(helps) : noteText({ key: "ed.helps", values: { level: levelAbove(level) ?? "the next level" } });
  }
  const read =
    round === "ed2"
      ? verdict === "helps" || verdict === "improves" || verdict === "same"
        ? `${base} Early decision II too, though less: ${name} reports its ED rounds together, and much of the class is admitted in the first.`
        : `${base} Early decision II is binding too.`
      : round === "ed_alt"
        ? `${base} Early decision is binding at one college only, so this is an alternative to your other ED opportunity, not a second one.`
        : base;

  const hasCounts = ed?.applicants != null && ed?.admitted != null && ed.applicants > 0;
  const m = early.measures;
  let reported: string | null = null;
  let lineage: string | null = null;
  let overallFromAdmitRate = false;
  if (hasCounts && m?.edRate != null) {
    const totals = school.edTotals;
    const sameDoc = totals?.applicants && totals.admitted != null ? totals.admitted / totals.applicants : null;
    const overall = sameDoc ?? school.admitRate;
    reported = `ED admitted ${int(ed!.admitted!)} of ${int(ed!.applicants!)} (${pct(m.edRate)})` + (overall != null ? ` against ${pct(overall)} overall` : "");
    if (sameDoc != null) lineage = "same document";
    else if (overall != null) {
      overallFromAdmitRate = true;
      const y = yearOf(school.admitRateCite);
      lineage = y ? `overall rate from ${y}` : "overall rate from another release";
    }
  }
  const edition = hasCounts ? ((school.cites[early.field] as { cdsEdition?: string } | undefined)?.cdsEdition ?? null) : null;

  const d = roundDates(school, datesRound(round));
  const label = (x: RoundDate | null): EdSheetDate | null => (x ? { ...x, label: dayLabel(x.iso) } : null);
  const closing = label(d.closing);

  return {
    name,
    unitId: school.unit_id,
    round,
    levelLabel: level ? STANDING_LEVEL_LABELS[level] : null,
    read,
    // The college's own line without its "×" multiple: the pill and sheet never show one (the guard in the tests).
    readBasis: (verdict === "improves" || verdict === "same") && early.measures?.edRate != null ? (early.line?.split(" · ")[0] ?? null) : null,
    framing: ED_FRAMING,
    reported,
    lineage,
    edition,
    countsField: early.field,
    overallFromAdmitRate,
    share: hasCounts ? classShareLine(m) : null,
    together: isOffered(school, "ed2") === true,
    noCounts: early.offered && !hasCounts ? `ED offered; ${name} hasn't published its ED counts` : null,
    questions: [
      { key: "attend", text: "Would you go if admitted, whatever the others say?" },
      { key: "cost", text: "Has a parent checked the cost?" },
      { key: "ready", text: round === "ed2" && closing ? `Can the application be ready by ${closing.label}?` : "Can the application be ready by mid-October?" },
    ],
    closing,
    notification: label(d.notification),
    dateNote: lastCycleNote(d, school.cycleStartYear),
    calculator: school.links?.price_calculator ?? null,
    profileHref: `/schools/${school.unit_id}/admissions#early`,
    profileLabel: `How early rounds work at ${name}`,
    onPlan: row.round === datesRound(round),
  };
}
