/**
 * The splash page's sample student (specs/product/advisor.md "3. The page: /advisor, signed out"): the fixture's shape
 * (`the snapshot's reference/sample-plan.json`), its validation, and `buildSplash`, which turns it into the plain, serializable
 * data every frame renders from. The student is made up and labeled; every college fact (name, city, admit rate,
 * cost, deadlines, applicant interest, the offers' context lines) is read here from the dataset and carries its
 * citation (`citeField`), never from the fixture. The levels are the fixture's (declared, not estimated: no estimate
 * call, no store). Pure: the server page passes the dataset in, and tests/advisor-splash.test.mts passes one it built.
 */
import type { Dataset } from "@/lib/dataset";
import type { AnyCited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import type { School } from "@/lib/types";
import type { StandingLevel } from "@/lib/chances/types";
import type { ListRound } from "@/lib/list-rules";
import type { OfferGift, OfferLoan } from "@/lib/planner/types";
import type { OfferColumn } from "@/components/planner/OffersTable";
import { crestBrand, shortName, type CrestBrand } from "@/lib/brand";
import { admitRatioFromRate } from "@/lib/metrics";
import { STANDING_LEVELS } from "@/lib/chances/levels";
import { GUIDES, type GuideSlug } from "@/lib/planner/guides";
import { INTEREST_FIELD } from "@/lib/planner/interest";
import { shapeFor } from "@/lib/planner/list-shape";
import { ROUND_SHORT } from "@/lib/planner/rounds";
import { SEASON_LABELS, type Season } from "@/lib/planner/seasons";
import { addDaysIso, dayLabel, type CalendarLane, type YearRange } from "@/lib/planner/calendar";
import { currentCycle, loadCycle } from "@/lib/planner/cycle";
import { LOANS, cfpView, fourYears, type FallbackCoa, type OfferFacts } from "@/lib/planner/offers";
import { advisorTitle } from "@/lib/planner/advisor";

/* ------------------------------------------------------------------ */
/* The fixture                                                         */
/* ------------------------------------------------------------------ */

export interface SampleFixture {
  name: string;
  gradYear: number;
  season: Season;
  /** The sample family's state, for which full price a public college charges (in-state or out). */
  homeState: string;
  /** The sample's own target score (the "Work toward your {target}" move). */
  target: number;
  colleges: { unit_id: string; level: StandingLevel; dream?: boolean }[];
  /** Three Now cards, in the catalog's words; `unit_id` names the college a move's fact is cited from. */
  moves: { title: string; why: string; guide: GuideSlug; unit_id?: string }[];
  /** The calendar frame's "today": the day before the text bubble's deadline. */
  calendarToday: string;
  /** Deadlines (date from the dataset, checked by the test), a test date (from the cycle file), and a visit. */
  calendar: { iso: string; kind: "deadline" | "test" | "visit"; label: string; unit_id?: string; round?: ListRound; cycle_key?: string }[];
  parent: { done: { title: string; on: string }[]; skipped: { title: string; on: string }[]; nudged: number };
  /** The sample's own award letters (gifts, loans, work-study); the cost of attendance is the college's full price. */
  offers: { unit_id: string; gift: OfferGift[]; work_study: number | null; loans: OfferLoan[] }[];
}

/** The queries the builder reads (a slice of `getData()`'s dataset). */
export type SampleDataset = Pick<Dataset, "getSchoolById" | "citeField" | "getDatasetSummary" | "cdsSchools" | "getAllSchools">;

/** What's wrong with a fixture against the dataset, as sentences; empty when it's sound. */
export function validateSample(f: SampleFixture, ds: Pick<Dataset, "getSchoolById">): string[] {
  const errors: string[] = [];
  if (f.colleges.length !== 5) errors.push(`expected five colleges, found ${f.colleges.length}`);
  const levels = new Set(f.colleges.map((c) => c.level));
  for (const l of STANDING_LEVELS) if (!levels.has(l)) errors.push(`no college at ${l}`);
  for (const c of f.colleges) if (!ds.getSchoolById(c.unit_id)) errors.push(`unit id ${c.unit_id} is not in the dataset`);
  if (f.moves.length !== 3) errors.push(`expected three moves, found ${f.moves.length}`);
  for (const m of f.moves) if (!(m.guide in GUIDES)) errors.push(`unknown guide ${m.guide}`);
  const onList = new Set(f.colleges.map((c) => c.unit_id));
  for (const m of f.moves) if (m.unit_id && !onList.has(m.unit_id)) errors.push(`move "${m.title}" names a college not on the list`);
  for (const e of f.calendar) {
    if (e.unit_id && !onList.has(e.unit_id)) errors.push(`calendar entry "${e.label}" names a college not on the list`);
    if (e.kind === "deadline") {
      const school = e.unit_id ? ds.getSchoolById(e.unit_id) : null;
      const iso = school && e.round ? deadlineOf(school, e.round) : null;
      if (iso !== e.iso) errors.push(`calendar deadline "${e.label}" is ${e.iso}; the dataset says ${iso}`);
    }
  }
  for (const o of f.offers) if (!onList.has(o.unit_id)) errors.push(`offer at ${o.unit_id} is not on the list`);
  return errors;
}

/* ------------------------------------------------------------------ */
/* What the frames render                                              */
/* ------------------------------------------------------------------ */

export interface SampleCollege {
  unit_id: string;
  name: string;
  city: string;
  state: string;
  level: StandingLevel;
  dream: boolean;
  brand?: CrestBrand;
  /** "1 in 19" or "7 in 10" admitted, cited. */
  admitted: string | null;
  admittedCite: AnyCited | null;
}

export interface SampleMove {
  title: string;
  why: string;
  guide: GuideSlug;
  /** The guide's own button words ("Help me build it"). */
  button: string;
  /** The college fact behind the why, cited on "this season" as MoveCard does. */
  cite: AnyCited | null;
}

export interface SampleCalendar {
  today: string;
  range: YearRange;
  /** Week ticks across the month: their ISO day and label ("Nov 8"). */
  ticks: { iso: string; label: string }[];
  monthLabel: string;
  lanes: CalendarLane[];
  /** Field citations by `${unitId}:${field}`, resolved on the server (the lane's popover links to them). */
  cites: Record<string, { url: string }>;
  bubble: string | null;
}

export interface SampleParent {
  title: string;
  open: { title: string; nudge: boolean }[];
  done: { title: string; label: string }[];
  skipped: { title: string; label: string }[];
}

export interface SampleReads {
  colleges: number;
  cdsColleges: number;
  commonAppColleges: number;
  commonAppCite: AnyCited;
}

export interface SplashData {
  /** "Sample: Jordan, class of 2028", the corner of every frame. */
  badge: string;
  name: string;
  gradYear: number;
  /** "Junior spring · Class of 2028", the Now tab's header. */
  seasonHeading: string;
  /** "A good senior list has 12 to 15 colleges; Jordan has 5." */
  shapeLine: string;
  colleges: SampleCollege[];
  moves: SampleMove[];
  calendar: SampleCalendar;
  parent: SampleParent;
  offers: OfferColumn[];
  reads: SampleReads;
}

const cite = (c: unknown) => c as AnyCited;

/** A college's deadline for a round, from the Common App grid (`apply.deadlines`); null when it has none. */
export function deadlineOf(school: Pick<School, "apply">, round: ListRound): string | null {
  const d = school.apply?.deadlines;
  if (!d) return null;
  const v = round === "rd" ? d.regular : round === "rolling" ? null : (d[round as "ed" | "ed2" | "ea" | "rea"] ?? null);
  return v && v !== "rolling" ? v : null;
}

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function calendarOf(f: SampleFixture, ds: SampleDataset, schoolOf: (id: string) => School): SampleCalendar {
  const today = f.calendarToday;
  const month = today.slice(0, 7);
  const range: YearRange = { startYear: Number(today.slice(0, 4)), from: `${month}-01`, to: lastDayOf(month) };
  // Four week ticks: a fifth (the 29th) sits at the lane's right edge and runs into the one before it on a phone.
  const ticks = [1, 8, 15, 22].map((d) => `${month}-${String(d).padStart(2, "0")}`).filter((iso) => iso <= range.to).map((iso) => ({ iso, label: dayLabel(iso) }));
  const cycle = loadCycle(currentCycle(today));
  const lanes: CalendarLane[] = [];
  const cites: Record<string, { url: string }> = {};

  const tests = f.calendar.filter((e) => e.kind === "test");
  if (tests.length) {
    lanes.push({
      key: "tests",
      label: "SAT dates",
      sub: "pick one or two",
      marks: tests.map((e) => {
        const entry = cycle.entries.find((c) => c.key === e.cycle_key);
        const date = entry?.date ?? e.iso;
        return { kind: "test" as const, date, past: date < today, tip: `${e.label} ${dayLabel(date)}`, cite: entry?.source ? { kind: "link" as const, url: entry.source } : null };
      }),
    });
  }

  const deadlines = f.calendar
    .filter((e) => e.kind === "deadline" && e.unit_id && e.round)
    .map((e) => ({ e, school: schoolOf(e.unit_id!), round: e.round! }))
    .map((d) => ({ ...d, iso: deadlineOf(d.school, d.round) }))
    .filter((d): d is typeof d & { iso: string } => d.iso !== null && d.iso >= range.from && d.iso <= range.to)
    .sort((a, b) => a.iso.localeCompare(b.iso));
  for (const { school, round, iso } of deadlines) {
    const field = "apply.deadlines";
    cites[`${school.unit_id}:${field}`] = { url: ds.citeField(field, school).url };
    const start = addDaysIso(iso, -42) < range.from ? range.from : addDaysIso(iso, -42);
    const name = shortName(school);
    const c = { kind: "field" as const, unitId: school.unit_id, field };
    const dream = f.colleges.find((x) => x.unit_id === school.unit_id)?.dream ?? false;
    lanes.push({
      key: `college:${school.unit_id}`,
      label: name,
      sub: dream ? "Dream" : undefined,
      // The six working weeks before the deadline, cut at the month's start (no bar when the deadline is the 1st).
      marks: [
        ...(start < iso ? [{ kind: "bar" as const, start, end: iso, round, label: ROUND_SHORT[round], tip: `${name} · ${ROUND_SHORT[round]} · due ${dayLabel(iso)}`, cite: c }] : []),
        { kind: "deadline" as const, date: iso, round, tip: `${name} ${ROUND_SHORT[round]} due ${dayLabel(iso)}`, cite: c },
      ],
    });
  }

  const visits = f.calendar.filter((e) => e.kind === "visit");
  if (visits.length) {
    lanes.push({ key: "visits", label: "Visits", marks: visits.map((e) => ({ kind: "visit" as const, date: e.iso, tip: `${e.label} · ${dayLabel(e.iso)}`, cite: null })) });
  }

  const tomorrow = deadlines.find((d) => d.iso === addDaysIso(today, 1));
  const bubble = tomorrow ? `Tomorrow: ${shortName(tomorrow.school)} ${ROUND_SHORT[tomorrow.round]} application is due` : null;
  return { today, range, ticks, monthLabel: MONTH_NAMES[Number(month.slice(5, 7)) - 1], lanes, cites, bubble };
}

/** The full price that applies to the sample family (in-state at a public in their state, else out-of-state), cited. */
function fallbackFor(school: School, homeState: string, ds: SampleDataset): FallbackCoa {
  const s = school.cost?.sticker;
  if (!s) return { amount: null, year: null };
  const amount = school.location?.state === homeState ? (s.in_state ?? s.out_of_state) : (s.out_of_state ?? s.in_state);
  return { amount: amount ?? null, year: amount != null ? ds.citeField("cost.sticker", school).year : null };
}

/** The newest award year the loans reference has rates for, so the sample's payments use an announced rate. */
const NEWEST_AWARD_YEAR = Math.max(...LOANS.rates.map((r) => r.award_year));

/**
 * The frames' data. `facts` are the offers' context lines (`offerFacts` in lib/planner/offers-server.ts, server-only),
 * by unit id; without them the offers table shows the family's numbers only.
 */
export function buildSplash(f: SampleFixture, ds: SampleDataset, facts: Record<string, OfferFacts> = {}): SplashData {
  const schoolOf = (id: string): School => {
    const s = ds.getSchoolById(id);
    if (!s) throw new Error(`sample-plan.json: unit id ${id} is not in the dataset`);
    return s;
  };
  const colleges: SampleCollege[] = STANDING_LEVELS.flatMap((level) => f.colleges.filter((c) => c.level === level)).map((c) => {
    const s = schoolOf(c.unit_id);
    const rate = s.admissions.acceptance_rate;
    return {
      unit_id: s.unit_id,
      name: s.name,
      city: s.location.city,
      state: s.location.state,
      level: c.level,
      dream: c.dream ?? false,
      brand: crestBrand(s),
      admitted: admitRatioFromRate(rate),
      admittedCite: rate !== null ? cite(ds.citeField("admissions.acceptance_rate", s)) : null,
    };
  });
  const shape = shapeFor(f.season);
  const shapeLine = shape ? `A good senior list has ${shape.total[0]} to ${shape.total[1]} colleges; ${f.name} has ${f.colleges.length}.` : `${f.name} has ${f.colleges.length} colleges.`;
  const moves: SampleMove[] = f.moves.map((m) => ({
    title: m.title,
    why: m.why,
    guide: m.guide,
    button: GUIDES[m.guide].button,
    cite: m.unit_id ? cite(ds.citeField(INTEREST_FIELD as FieldPath, schoolOf(m.unit_id))) : null,
  }));
  const offers: OfferColumn[] = f.offers.map((o, i) => {
    const s = schoolOf(o.unit_id);
    const offer = {
      award_year: NEWEST_AWARD_YEAR,
      coa: { tuition_fees: null, housing_food: null, books: null, transport: null, personal: null, other: null, total: null, stated_by_college: false },
      gift: o.gift,
      work_study: o.work_study,
      loans: o.loans,
    };
    const view = cfpView(offer, fallbackFor(s, f.homeState, ds));
    const fact = facts[o.unit_id] ?? null;
    return {
      itemId: `sample-${o.unit_id}`,
      unitId: o.unit_id,
      school: { unit_id: s.unit_id, name: s.name, brand: crestBrand(s) },
      position: i,
      dream: f.colleges.find((c) => c.unit_id === o.unit_id)?.dream ?? false,
      offerId: `sample-${o.unit_id}`,
      awardYear: NEWEST_AWARD_YEAR,
      draft: null,
      view,
      four: fourYears(offer, view, fact?.trend ?? null),
      facts: fact,
      distanceMiles: null,
      visitRating: null,
      canEdit: false,
    };
  });
  const all = ds.getAllSchools();
  return {
    badge: `Sample: ${f.name}, class of ${f.gradYear}`,
    name: f.name,
    gradYear: f.gradYear,
    seasonHeading: `${SEASON_LABELS[f.season]} · Class of ${f.gradYear}`,
    shapeLine,
    colleges,
    moves,
    calendar: calendarOf(f, ds, schoolOf),
    parent: {
      title: advisorTitle(f.name),
      open: f.moves.map((m, i) => ({ title: m.title, nudge: i === f.parent.nudged })),
      done: f.parent.done.map((d) => ({ title: d.title, label: `Done ${dayLabel(d.on)}` })),
      skipped: f.parent.skipped.map((d) => ({ title: d.title, label: `Skipped ${dayLabel(d.on)}` })),
    },
    offers,
    reads: {
      colleges: ds.getDatasetSummary().count,
      // Colleges with any college-reported figures (the agent's CDS and class-profile reads), not only the hand-imported
      // Common Data Sets `cdsSchools()` counts (8).
      cdsColleges: all.filter((s) => s.reported && Object.keys(s.reported).length > 0).length,
      commonAppColleges: all.filter((s) => s.apply?.common_app?.member).length,
      commonAppCite: cite(ds.citeField("apply.common_app")),
    },
  };
}
