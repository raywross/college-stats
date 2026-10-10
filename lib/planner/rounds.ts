/**
 * Stage 2, priorities and rounds (specs/planner/early-rounds.md). Pure: which rounds a college offers and when (CDS
 * C21/C22 for the early rounds, C14/C16 for regular and rolling), the priority order, the proposal (six numbered rules,
 * a reason per line), the conflicts between the chosen rounds (red or amber), the three-question checklist for a
 * binding choice, and the one-line summary. Runs on the server (the stage machine's conflict count) and in the browser
 * (the table re-checks as the student edits), so no I/O and no server imports.
 *
 * Rules (early-rounds.md "Rules"): no sentence recommends a college ("goes to" and "because"; the student changes any
 * line); the advantage is a multiple of the non-ED rate, never odds; dates come from the edition on record, and a date
 * from an earlier cycle's edition says so.
 */
import { ROUND_LABELS, type ListRound } from "../list-rules.ts";
import { money as usd } from "../format.ts";
import { advantageLine, classShareLine, earlyMeasures, type EarlyMeasures } from "../early.ts";
import type { PlanItem, PlanSchool } from "./types.ts";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** The slice of PlanSchool this module reads. */
export type RoundsSchool = Pick<PlanSchool, "unit_id" | "name" | "profile" | "logistics" | "cycleStartYear" | "editionIsLastCycle" | "cites" | "admitRate" | "avgCost" | "links"> &
  Partial<Pick<PlanSchool, "type" | "edTotals">>;

/** The slice of a list item this module reads. */
export type RoundsItem = Pick<PlanItem, "id" | "unit_id" | "category" | "status" | "outcome" | "round" | "position"> & Partial<Pick<PlanItem, "dream" | "priority">>;

export const ROUND_SHORT: Record<ListRound, string> = { ed: "ED I", ed2: "ED II", ea: "EA", rea: "REA", rd: "RD", rolling: "Rolling" };
/** Chip order in the table. */
export const ROUND_ORDER: readonly ListRound[] = ["ed", "ed2", "rea", "ea", "rd", "rolling"];
/** Binding rounds (the checklist runs for these). */
export const BINDING: readonly ListRound[] = ["ed", "ed2"];
/** Early rounds (the decide-rounds step and the stage's "offers an early round"). */
export const EARLY: readonly ListRound[] = ["ed", "ed2", "ea", "rea"];

/* ------------------------------------------------------------------ */
/* Offered                                                             */
/* ------------------------------------------------------------------ */

/**
 * Whether a college offers `round` in its published rounds: true, false (the record says no), or null (the college
 * hasn't published that part). ED and ED II read C21 (ED II is the "other" round), EA and REA read C22 (restrictive
 * splits them; single-choice early action is restrictive in the CDS), rolling and regular read C16/C14.
 */
export function isOffered(school: Pick<RoundsSchool, "profile" | "logistics"> | null | undefined, round: ListRound): boolean | null {
  const ed = school?.profile?.early_decision;
  const ea = school?.profile?.early_action;
  const lg = school?.logistics ?? null;
  switch (round) {
    case "ed":
      return ed ? ed.offered === true : null;
    case "ed2":
      return ed ? ed.offered === true && !!ed.other : null;
    case "ea":
      return ea ? ea.offered === true && ea.restrictive !== true : null;
    case "rea":
      return ea ? ea.offered === true && ea.restrictive === true : null;
    case "rolling":
      return lg?.notification ? lg.notification.kind === "rolling" : null;
    case "rd":
      if (!lg) return null;
      if (lg.notification?.kind === "rolling" && !lg.regular_closing) return false;
      return true;
  }
}

export interface RoundsOffered {
  /** Rounds the record says the college offers, in chip order. */
  offered: ListRound[];
  /** Rounds a student may pick: everything not ruled out by the record (unknown stays pickable). */
  pickable: ListRound[];
  /** False when the college has published nothing about its rounds ("the college hasn't published its rounds"). */
  published: boolean;
}

export function roundsOffered(school: Pick<RoundsSchool, "profile" | "logistics"> | null | undefined): RoundsOffered {
  const offered = ROUND_ORDER.filter((r) => isOffered(school, r) === true);
  const pickable = ROUND_ORDER.filter((r) => isOffered(school, r) !== false);
  const published = !!(school?.profile?.early_decision || school?.profile?.early_action || school?.logistics);
  return { offered, pickable, published };
}

/** Whether the college offers any early round (the stage machine's "a college that offers an early round"). */
export function offersEarly(school: Pick<RoundsSchool, "profile" | "logistics"> | null | undefined): boolean {
  return EARLY.some((r) => isOffered(school, r) === true);
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

type MD = { month: number | null; day: number | null } | null | undefined;

/** A CDS month/day in the cycle that starts in `startYear`: July or later is that year, else the next (lib/list-rules.ts deadlineFor's rule). */
export function resolveMonthDay(md: MD, startYear: number): string | null {
  if (!md || md.month === null || md.day === null || md.month < 1 || md.month > 12) return null;
  const year = md.month >= 7 ? startYear : startYear + 1;
  return `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
}

export interface RoundDate {
  /** yyyy-mm-dd in the student's cycle. */
  iso: string;
  /** The registered field path (cite it with PlanSchool.cites[field]). */
  field: string;
}

export interface RoundDates {
  closing: RoundDate | null;
  notification: RoundDate | null;
  /** The CDS edition the dates came from (lineage), or null. */
  edition: string | null;
  /** The dates come from an edition for an earlier cycle than the student's. */
  lastCycle: boolean;
}

const AP = "reported.admission_profile";
const LG = "reported.admissions_logistics";

/** Which fields hold a round's closing and notification dates. */
export const ROUND_FIELDS: Record<ListRound, { closing: string | null; notification: string | null }> = {
  ed: { closing: `${AP}.early_decision.first.closing`, notification: `${AP}.early_decision.first.notification` },
  ed2: { closing: `${AP}.early_decision.other.closing`, notification: `${AP}.early_decision.other.notification` },
  ea: { closing: `${AP}.early_action.closing`, notification: `${AP}.early_action.notification` },
  rea: { closing: `${AP}.early_action.closing`, notification: `${AP}.early_action.notification` },
  rd: { closing: `${LG}.regular_closing`, notification: `${LG}.notification` },
  rolling: { closing: `${LG}.priority_date`, notification: `${LG}.notification` },
};

/** The CDS edition a cited field came from: the citation's edition, else its year, else the logistics block's edition. */
export function editionOf(school: Pick<RoundsSchool, "cites" | "logistics">, field: string | null): string | null {
  const cite = field ? (school.cites[field] as { cdsEdition?: string; year?: string | null } | undefined) : undefined;
  if (cite?.cdsEdition) return cite.cdsEdition;
  if (field?.startsWith(LG) && school.logistics?.edition) return school.logistics.edition;
  return null;
}

/** "2025–26" → 2025 (an edition describes the cycle that starts in its first year). */
const editionStart = (e: string | null) => {
  const m = e?.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
};

/** "2026–27" for the cycle that starts in 2026. */
export function cycleLabel(startYear: number): string {
  return `${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** A round's closing and notification dates resolved in the student's cycle, with their fields and edition. */
export function roundDates(school: RoundsSchool | null | undefined, round: ListRound): RoundDates {
  if (!school) return { closing: null, notification: null, edition: null, lastCycle: false };
  const ed = school.profile?.early_decision;
  const ea = school.profile?.early_action;
  const lg = school.logistics;
  let closing: MD = null;
  let notification: MD = null;
  switch (round) {
    case "ed":
      closing = ed?.first?.closing;
      notification = ed?.first?.notification;
      break;
    case "ed2":
      closing = ed?.other?.closing;
      notification = ed?.other?.notification;
      break;
    case "ea":
    case "rea":
      closing = ea?.closing;
      notification = ea?.notification;
      break;
    case "rd":
      closing = lg?.regular_closing;
      notification = lg?.notification?.kind === "by_date" ? lg.notification.by_date : (lg?.notification?.other_date ?? null);
      break;
    case "rolling":
      closing = lg?.priority_date;
      notification = lg?.notification?.kind === "rolling" ? lg.notification.rolling_from : null;
      break;
  }
  const f = ROUND_FIELDS[round];
  const c = resolveMonthDay(closing, school.cycleStartYear);
  const n = resolveMonthDay(notification, school.cycleStartYear);
  const edition = editionOf(school, c ? f.closing : n ? f.notification : f.closing);
  const start = editionStart(edition);
  return {
    closing: c && f.closing ? { iso: c, field: f.closing } : null,
    notification: n && f.notification ? { iso: n, field: f.notification } : null,
    edition,
    lastCycle: start !== null ? start < school.cycleStartYear : school.editionIsLastCycle,
  };
}

/** "2025–26 dates; the college hasn't published 2026–27" for dates from an earlier cycle's edition, else null. */
export function lastCycleNote(dates: Pick<RoundDates, "edition" | "lastCycle">, cycleStartYear: number): string | null {
  if (!dates.lastCycle) return null;
  return `${dates.edition ? `${dates.edition} dates` : "Last cycle's dates"}; the college hasn't published ${cycleLabel(cycleStartYear)}`;
}

/** The earliest early-round closing date across the colleges, with its college and field; null when none is published. */
export function earliestEarlyDeadline(items: RoundsItem[], schools: Record<string, RoundsSchool>): { itemId: string; date: RoundDate; dates: RoundDates } | null {
  let best: { itemId: string; date: RoundDate; dates: RoundDates } | null = null;
  for (const item of items) {
    if (item.status === "decided") continue;
    const school = schools[item.unit_id];
    for (const r of EARLY) {
      if (isOffered(school, r) !== true) continue;
      const d = roundDates(school, r);
      if (d.closing && (!best || d.closing.iso < best.date.iso)) best = { itemId: item.id, date: d.closing, dates: d };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Early advantage and interest                                        */
/* ------------------------------------------------------------------ */

export interface EarlyFacts {
  offered: boolean | null;
  measures: EarlyMeasures | null;
  /** The advantage line, or null when the college doesn't offer ED. */
  line: string | null;
  /** "about 48% of the class (…)", or null. */
  share: string | null;
  /** The field that cites the counts (or ED itself when no counts). */
  field: string;
}

/** The ED advantage for a college (lib/early.ts), from its C21 counts and the same document's C1 totals. */
export function earlyFor(school: RoundsSchool | null | undefined): EarlyFacts {
  const ed = school?.profile?.early_decision;
  const offered = ed ? ed.offered : null;
  if (!school || !ed?.offered) return { offered, measures: null, line: null, share: null, field: `${AP}.early_decision.offered` };
  const measures = earlyMeasures({
    edApplicants: ed.applicants,
    edAdmitted: ed.admitted,
    totalApplicants: school.edTotals?.applicants ?? null,
    totalAdmitted: school.edTotals?.admitted ?? null,
    enrolled: school.edTotals?.enrolled ?? null,
    hasEarlyAction: school.profile?.early_action?.offered === true,
  });
  const hasCounts = ed.applicants !== null && ed.admitted !== null;
  const field = hasCounts ? `${AP}.early_decision.admitted` : `${AP}.early_decision.offered`;
  return { offered, measures, line: advantageLine(true, measures, hasCounts ? editionOf(school, `${AP}.early_decision.applicants`) : null), share: classShareLine(measures), field };
}

const INTEREST_LABELS = { very_important: "Very important", important: "Important", considered: "Considered", not_considered: "Not considered" } as const;

/** C7 "level of applicant's interest": "Considered", "Not considered", …, or null when unpublished. */
export function interestLabel(school: Pick<RoundsSchool, "profile"> | null | undefined): string | null {
  const v = school?.profile?.factors?.interest;
  return v ? INTEREST_LABELS[v] : null;
}

/** Whether the college weighs interest at all (so an early application is also a signal there). */
export function considersInterest(school: Pick<RoundsSchool, "profile"> | null | undefined): boolean {
  const v = school?.profile?.factors?.interest;
  return v === "very_important" || v === "important" || v === "considered";
}

/* ------------------------------------------------------------------ */
/* Standing and money (seams for chances-and-fit and the estimator)    */
/* ------------------------------------------------------------------ */

export type StandingLabel = "Reach for everyone" | "Reach" | "Target" | "Likely" | "Not sorted";
export interface Standing {
  label: StandingLabel;
  reason: string;
}

/** Under this admit rate a college is a Reach for every applicant (early-rounds.md "Your standing"). */
export const REACH_FOR_EVERYONE_RATE = 0.2;

/**
 * The stand-in for chances (owner assumption 2): "Reach for everyone" under a 20% admit rate, else the list's own
 * category. When chances-and-fit is built, its output replaces this map; proposeRounds takes it as an input.
 */
export function standingFor(item: Pick<RoundsItem, "category">, school: Pick<RoundsSchool, "admitRate"> | null | undefined): Standing {
  const rate = school?.admitRate ?? null;
  if (rate !== null && rate < REACH_FOR_EVERYONE_RATE) return { label: "Reach for everyone", reason: `Admits fewer than ${Math.round(REACH_FOR_EVERYONE_RATE * 100)}% of applicants` };
  switch (item.category) {
    case "reach":
      return { label: "Reach", reason: "Your category on the list" };
    case "target":
      return { label: "Target", reason: "Your category on the list" };
    case "likely":
      return { label: "Likely", reason: "Your category on the list" };
    default:
      return { label: "Not sorted", reason: "Not sorted on the list yet" };
  }
}

/** A guardian's shared estimate (net-price-estimator, not built: always absent today). */
export interface Estimate {
  low: number;
  high: number;
  sharedBy: string | null;
}

/** What the money question reads: the family's limit (profile max average cost) and any shared estimates by item id. */
export interface MoneyInput {
  limit: number | null;
  estimates: Record<string, Estimate | null | undefined>;
}

export const NO_MONEY: MoneyInput = { limit: null, estimates: {} };

/* ------------------------------------------------------------------ */
/* Priority order                                                      */
/* ------------------------------------------------------------------ */

const CATEGORY_ORDER = { reach: 0, target: 1, likely: 2, unsorted: 3 } as const;

/**
 * "Where I'd go if admitted everywhere": the Dream first, then the student's priority (1 first), then colleges with no
 * priority by category (Reach, Target, Likely, Unsorted) and list position.
 */
export function priorityOrder<T extends RoundsItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (!!a.dream !== !!b.dream) return a.dream ? -1 : 1;
    const pa = a.priority ?? null;
    const pb = b.priority ?? null;
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
    return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.position - b.position;
  });
}

/** Whether the student has ranked the list (every live college has a priority). */
export function hasPriorities(items: RoundsItem[]): boolean {
  const live = items.filter((i) => i.status !== "decided");
  return live.length > 0 && live.every((i) => i.priority !== null && i.priority !== undefined);
}

/* ------------------------------------------------------------------ */
/* The proposal                                                        */
/* ------------------------------------------------------------------ */


const dayLabel = (iso: string) => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};


/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

export type ConflictKind = "ed_twice" | "ed2_twice" | "ed_with_rea" | "rea_with_private_ea" | "ed2_before_ed_decision" | "not_offered" | "ed_over_limit";
export type Severity = "red" | "amber";

export interface Conflict {
  kind: ConflictKind;
  severity: Severity;
  itemIds: string[];
  text: string;
  /** Where to check (the college's admissions page, its calculator). */
  link: string | null;
}

export const CONFLICT_SEVERITY: Record<ConflictKind, Severity> = {
  ed_twice: "red",
  ed2_twice: "red",
  ed_with_rea: "red",
  rea_with_private_ea: "amber",
  ed2_before_ed_decision: "amber",
  not_offered: "red",
  ed_over_limit: "amber",
};

/** An item whose round still binds or restricts (decided colleges other than an admit no longer do). */
const active = (i: RoundsItem) => i.round !== null && !(i.status === "decided" && i.outcome !== "admitted");

/**
 * Every conflict among the chosen rounds (early-rounds.md "Conflicts"). Red: two EDs, two ED IIs, ED with REA, a round
 * the college doesn't offer. Amber: REA beside a private college's EA, an ED II due before the ED college decides, an
 * ED college with no estimate whose average cost is above the family's limit. A plan with a red conflict can be saved.
 */
export function conflicts(items: RoundsItem[], schools: Record<string, RoundsSchool>, money: MoneyInput = NO_MONEY): Conflict[] {
  const out: Conflict[] = [];
  const name = (i: RoundsItem) => schools[i.unit_id]?.name ?? "A college";
  const live = items.filter(active);
  const by = (r: ListRound) => live.filter((i) => i.round === r);
  const eds = by("ed");
  const ed2s = by("ed2");
  const reas = by("rea");
  const names = (list: RoundsItem[]) => list.map(name).join(" and ");
  const admissions = (i: RoundsItem) => schools[i.unit_id]?.links?.admissions ?? schools[i.unit_id]?.links?.website ?? null;

  if (eds.length > 1) out.push({ kind: "ed_twice", severity: "red", itemIds: eds.map((i) => i.id), text: `ED I at ${names(eds)}: early decision is binding, so only one college can have it`, link: null });
  if (ed2s.length > 1) out.push({ kind: "ed2_twice", severity: "red", itemIds: ed2s.map((i) => i.id), text: `ED II at ${names(ed2s)}: early decision II is binding, so only one college can have it`, link: null });
  if (eds.length > 0 && reas.length > 0)
    out.push({
      kind: "ed_with_rea",
      severity: "red",
      itemIds: [...eds, ...reas].map((i) => i.id),
      text: `ED I at ${names(eds)} with REA at ${names(reas)}: restrictive early action rules out early decision elsewhere`,
      link: admissions(reas[0]),
    });
  for (const r of reas) {
    for (const i of by("ea")) {
      if (schools[i.unit_id]?.type === "public") continue;
      out.push({
        kind: "rea_with_private_ea",
        severity: "amber",
        itemIds: [r.id, i.id],
        text: `REA at ${name(r)} with EA at ${name(i)}: check whether ${name(r)}'s restrictive early action allows this`,
        link: admissions(r),
      });
    }
  }
  for (const e of eds) {
    const decides = roundDates(schools[e.unit_id], "ed").notification;
    for (const i of ed2s) {
      const due = roundDates(schools[i.unit_id], "ed2").closing;
      if (decides && due && due.iso < decides.iso) {
        out.push({
          kind: "ed2_before_ed_decision",
          severity: "amber",
          itemIds: [e.id, i.id],
          text: `ED II at ${name(i)} is due ${dayLabel(due.iso)}, before ${name(e)} decides (${dayLabel(decides.iso)}): you'd have to decide before you hear from ${name(e)}`,
          link: null,
        });
      }
    }
  }
  for (const i of live) {
    if (isOffered(schools[i.unit_id], i.round!) === false) {
      out.push({
        kind: "not_offered",
        severity: "red",
        itemIds: [i.id],
        text: `${name(i)} doesn't offer ${ROUND_LABELS[i.round!].toLowerCase()} in its published rounds`,
        link: admissions(i),
      });
    }
  }
  if (money.limit !== null) {
    for (const i of [...eds, ...ed2s]) {
      const school = schools[i.unit_id];
      if (money.estimates[i.id] || school?.avgCost == null || school.avgCost <= money.limit) continue;
      out.push({
        kind: "ed_over_limit",
        severity: "amber",
        itemIds: [i.id],
        text: `${name(i)} is ${ROUND_SHORT[i.round!]} with no estimate yet, and its average cost (${usd(school.avgCost)}) is above your limit (${usd(money.limit)}): run the college's calculator`,
        link: school.links?.price_calculator ?? null,
      });
    }
  }
  return out;
}

/** The red conflicts' count: what the stage strip shows ("1 conflict"; lib/planner/stage.ts StageInput.conflicts). */
export function redConflictCount(items: RoundsItem[], schools: Record<string, RoundsSchool>): number {
  return conflicts(items, schools).filter((c) => c.severity === "red").length;
}


/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/** "ED I Michigan · ED II Tufts (if needed) · EA at 3 · RD at 4", from the items' rounds; null when none is set. */
export function roundsSummary(items: RoundsItem[], schools: Record<string, RoundsSchool>): string | null {
  const live = items.filter((i) => i.round !== null && i.status !== "decided");
  if (live.length === 0) return null;
  const name = (i: RoundsItem) => schools[i.unit_id]?.name ?? "a college";
  const named = (r: ListRound, suffix = "") => live.filter((i) => i.round === r).map((i) => `${ROUND_SHORT[r]} ${name(i)}${suffix}`);
  const count = (r: ListRound) => {
    const n = live.filter((i) => i.round === r).length;
    return n > 0 ? [`${ROUND_SHORT[r]} at ${n}`] : [];
  };
  return [...named("ed"), ...named("ed2", " (if needed)"), ...named("rea"), ...count("ea"), ...count("rolling"), ...count("rd")].join(" · ");
}
