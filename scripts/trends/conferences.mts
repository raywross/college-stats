/**
 * Trends by athletic conference (specs/trends/conferences.md) → data/history/trends/conferences.json.
 *
 * - Members are today's (`campus.athletics.conference`, the snapshot); "members at the time" reads each college's
 *   `conference` history series, so it covers colleges on the site today only (closed colleges have no shard).
 * - Medians need CONFERENCE_FLOOR (8) members, and a year's median is published only when CONFERENCE_COVERAGE (80%)
 *   of the members that year report it (spec rule 3). Under the floor: listed, no medians.
 * - Independents, ECAC, and "Other" aren't leagues (`isLeague`): listed under "No conference", never summarized.
 *   A football-only league (no college lists it as its main conference) is listed with its football members and no
 *   medians (owner assumption 6).
 * - Joins, departures, and moves per year come from lib/events.ts `conferenceMoves`, with its reporting-fix rules.
 * - The national context line is every college's median from data/history/national.json.
 */
import { CONFERENCES, CONFERENCE_LEVELS, conferenceName, isLeague } from "../../lib/conferences.ts";
import { conferenceMoves } from "../../lib/events.ts";
import { SERIES, real, seriesStep, valueAt, type CpiTable, type SeriesKey } from "../../lib/history.ts";
import { CONFERENCE_FLOOR } from "../../lib/trend-groups.ts";
import { at, medianBy, quantile, round4, yearly, type Member } from "../../lib/trend-panel.ts";
import type {
  ConferenceGlance,
  ConferenceGlanceKey,
  ConferenceGlanceMeta,
  ConferenceMeasureKey,
  ConferenceMeasureMeta,
  ConferenceMove,
  ConferenceRow,
  ConferencesFile,
  MembershipRule,
  ThenNow,
} from "../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "./context.mts";

const NAME = "conferences";

/** A year's median is shown only when this share of that year's members report it (spec rule 3). */
export const CONFERENCE_COVERAGE = 0.8;

/** The over-time measures, in the segmented control's order. */
export const CONFERENCE_MEASURES: readonly ConferenceMeasureKey[] = ["applicants", "acceptance_rate", "undergrads", "avg_paid_all", "out_of_state_share"];
/** The at-a-glance strip's measures, in order. "pell" is the snapshot's share of undergraduates with a Pell Grant. */
export const CONFERENCE_GLANCE: readonly ConferenceGlanceKey[] = ["acceptance_rate", "applicants", "undergrads", "avg_paid_all", "out_of_state_share", "grad_rate", "pell"];

const WINDOW = 10;

const r4 = (v: number | null) => (v === null ? null : round4(v));
/** Counts and dollars to whole numbers; shares to 4 decimals. */
const roundFor = (key: SeriesKey, v: number | null) => (v === null ? null : SERIES[key].unit === "share" ? round4(v) : Math.round(v));

const mainCode = (m: Member) => m.school.campus?.athletics?.conference?.code ?? null;
const footballCode = (m: Member) => m.school.campus?.athletics?.football_conference?.code ?? null;
const levelRank = (level: string | null) => {
  const i = CONFERENCE_LEVELS.findIndex((l) => l.level === level);
  return i < 0 ? CONFERENCE_LEVELS.length : i;
};

/** A measure's window and national line (money in the window's last school year's dollars). */
export function measureMeta(ctx: TrendContext, key: ConferenceMeasureKey): ConferenceMeasureMeta {
  const kind = SERIES[key].kind;
  const cadence = seriesStep(key);
  let to = ctx.hmeta.latest[kind];
  while (cadence > 1 && to % cadence !== 0) to--;
  const from = to - WINDOW;
  const money = SERIES[key].unit === "usd";
  const nat = ctx.national.series[key];
  const national = yearly(
    from,
    to,
    (y) => {
      const s = nat?.stats[y - nat.start];
      if (!s) return null;
      return roundFor(key, money ? real(s[1], y, ctx.cpi, to) : s[1]);
    },
    cadence
  );
  return { key, kind, from, to, cadence, ...(money ? { dollarsOf: to } : {}), national };
}

/** A member's value of `key` in `year`, in `meta`'s dollars for money. */
export function valueOf(m: Member, meta: ConferenceMeasureMeta, year: number, cpi: CpiTable): number | null {
  const v = at(m, meta.key, year);
  if (v === null || meta.dollarsOf === undefined) return v;
  return real(v, year, cpi, meta.dollarsOf);
}

/** Median of `value` over `ms` when at least CONFERENCE_COVERAGE of them report, else null. */
function coveredMedian(ms: readonly Member[], value: (m: Member) => number | null): number | null {
  if (!ms.length) return null;
  const vals = ms.map(value).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  return vals.length >= ms.length * CONFERENCE_COVERAGE ? quantile(vals, 0.5) : null;
}

/** The college's main conference in school year `year` (the `conference` series), or null. */
const codeIn = (m: Member, year: number) => valueAt(m.h.series.conference, year);

/** One measure's median line under one membership rule. */
export function conferenceLine(code: number, today: readonly Member[], all: readonly Member[], meta: ConferenceMeasureMeta, rule: MembershipRule, cpi: CpiTable): (number | null)[] {
  return yearly(
    meta.from,
    meta.to,
    (y) => {
      // Fall y is in school year y (fall 2014 → 2014–15), so both kinds read the conference series at `y`.
      const ms = rule === "today" ? today : all.filter((m) => codeIn(m, y) === code);
      if (ms.length < CONFERENCE_FLOOR) return null;
      return roundFor(meta.key, coveredMedian(ms, (m) => valueOf(m, meta, y, cpi)));
    },
    meta.cadence
  );
}

/** Median member's own % change (counts, money after inflation), over members reporting both ends; null under 80%. */
export function medianChange(ms: readonly Member[], meta: ConferenceMeasureMeta, cpi: CpiTable): number | null {
  const v = coveredMedian(ms, (m) => {
    const a = valueOf(m, meta, meta.from, cpi);
    const b = valueOf(m, meta, meta.to, cpi);
    return a && b !== null ? b / a - 1 : null;
  });
  return r4(v);
}

/** Median then and now for a rate, each over the members reporting that year. */
function thenNow(ms: readonly Member[], meta: ConferenceMeasureMeta, cpi: CpiTable): ThenNow | null {
  const a = coveredMedian(ms, (m) => valueOf(m, meta, meta.from, cpi));
  const b = coveredMedian(ms, (m) => valueOf(m, meta, meta.to, cpi));
  return a === null || b === null ? null : [round4(a), round4(b)];
}

/** Sums over members reporting both ends (a fixed panel); null under 80% of members. */
function total(ms: readonly Member[], meta: ConferenceMeasureMeta): { then: number; now: number; n: number } | null {
  const both = ms.filter((m) => at(m, meta.key, meta.from) !== null && at(m, meta.key, meta.to) !== null);
  if (!both.length || both.length < ms.length * CONFERENCE_COVERAGE) return null;
  const sum = (y: number) => both.reduce((s, m) => s + at(m, meta.key, y)!, 0);
  return { then: sum(meta.from), now: sum(meta.to), n: both.length };
}

/** Each at-a-glance measure's year and national median. */
export function glanceMeta(ctx: TrendContext, measures: readonly ConferenceMeasureMeta[]): ConferenceGlanceMeta[] {
  return CONFERENCE_GLANCE.map((key) => {
    if (key === "pell") {
      const vals = ctx.schools.map((s) => s.demographics.pell_grant_percent).filter((v): v is number => v !== null).sort((a, b) => a - b);
      return { key, year: null, kind: null, national: vals.length ? round4(quantile(vals, 0.5)) : null };
    }
    const m = measures.find((x) => x.key === key);
    const kind = SERIES[key].kind;
    const year = m ? m.to : ctx.hmeta.latest[kind];
    const nat = ctx.national.series[key];
    const s = nat?.stats[year - nat.start];
    return { key, year, kind, national: s ? roundFor(key, s[1]) : null };
  });
}

/** A member's at-a-glance value: history in its glance year (nominal dollars), Pell from today's snapshot. */
function glanceValue(m: Member, g: ConferenceGlanceMeta): number | null {
  if (g.key === "pell") return m.school.demographics.pell_grant_percent;
  return at(m, g.key, g.year!);
}

/** Join year per member: its latest main move into `code` after the series' first year. */
function joinYears(code: number, ms: readonly Member[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of ms) {
    const join = conferenceMoves(m.h).filter((mv) => !mv.football && mv.to === code).sort((a, b) => b.year - a.year)[0];
    if (join) out[m.school.unit_id] = join.year;
  }
  return out;
}

/** Every join and departure involving `code` across the site's colleges, newest first. */
function movesFor(code: number, all: readonly Member[]): ConferenceMove[] {
  const out: ConferenceMove[] = [];
  for (const m of all) {
    for (const mv of conferenceMoves(m.h)) {
      if (mv.to === code) out.push({ year: mv.year, unit_id: m.school.unit_id, other: mv.from, joined: true, football: mv.football });
      else if (mv.from === code) out.push({ year: mv.year, unit_id: m.school.unit_id, other: mv.to, joined: false, football: mv.football });
    }
  }
  return out.sort((a, b) => b.year - a.year || Number(b.joined) - Number(a.joined) || a.unit_id.localeCompare(b.unit_id));
}

export function buildConferences(ctx: TrendContext): TrendOutput {
  const all = ctx.members;
  const measures = CONFERENCE_MEASURES.map((k) => measureMeta(ctx, k));
  const glance = glanceMeta(ctx, measures);
  const byKey = (k: ConferenceMeasureKey) => measures.find((m) => m.key === k)!;

  const byMain = new Map<number, Member[]>();
  const byFootball = new Map<number, Member[]>();
  for (const m of all) {
    const c = mainCode(m);
    if (c !== null) byMain.set(c, [...(byMain.get(c) ?? []), m]);
    const f = footballCode(m);
    if (f !== null) byFootball.set(f, [...(byFootball.get(f) ?? []), m]);
  }

  const rows: ConferenceRow[] = [];
  const unaffiliated: ConferencesFile["unaffiliated"] = [];
  for (const [code, ms] of byMain) {
    if (!isLeague(code)) unaffiliated.push({ code, name: conferenceName(code) ?? String(code), members: ms.length });
  }
  const codes = new Set([...byMain.keys(), ...[...byFootball.keys()].filter((c) => !byMain.has(c))]);
  for (const code of codes) {
    if (!isLeague(code)) continue;
    const def = CONFERENCES[code];
    const ms = byMain.get(code) ?? [];
    const base = { code, name: def.name, slug: def.slug, level: def.level! };
    if (!ms.length) {
      const fm = byFootball.get(code) ?? [];
      rows.push({ ...base, members: [], footballOnly: true, footballMembers: fm.map((m) => m.school.unit_id), tooFew: true, joined: {}, football: {}, moves: movesFor(code, all) });
      continue;
    }
    const football: Record<string, number> = {};
    for (const m of ms) {
      const f = footballCode(m);
      if (f !== null && f !== code) football[m.school.unit_id] = f;
    }
    const row: ConferenceRow = { ...base, members: ms.map((m) => m.school.unit_id), joined: joinYears(code, ms), football, moves: movesFor(code, all) };
    if (ms.length < CONFERENCE_FLOOR) {
      rows.push({ ...row, tooFew: true });
      continue;
    }
    row.lines = Object.fromEntries(
      measures.map((meta) => [meta.key, { today: conferenceLine(code, ms, all, meta, "today", ctx.cpi), atTheTime: conferenceLine(code, ms, all, meta, "atTheTime", ctx.cpi) }])
    ) as NonNullable<ConferenceRow["lines"]>;
    row.change = {
      applicants: medianChange(ms, byKey("applicants"), ctx.cpi),
      undergrads: medianChange(ms, byKey("undergrads"), ctx.cpi),
      avg_paid_all: medianChange(ms, byKey("avg_paid_all"), ctx.cpi),
      acceptance_rate: thenNow(ms, byKey("acceptance_rate"), ctx.cpi),
      out_of_state_share: thenNow(ms, byKey("out_of_state_share"), ctx.cpi),
    };
    row.totals = { applicants: total(ms, byKey("applicants")), undergrads: total(ms, byKey("undergrads")) };
    row.glance = {};
    row.values = Object.fromEntries(ms.map((m) => [m.school.unit_id, glance.map((g) => glanceValue(m, g))]));
    for (const g of glance) {
      const vals = ms.map((m) => glanceValue(m, g)).filter((v): v is number => v !== null);
      if (vals.length && vals.length >= ms.length * CONFERENCE_COVERAGE) {
        vals.sort((a, b) => a - b);
        const round = (v: number) => (g.key === "pell" ? round4(v) : roundFor(g.key, v)!);
        const gl: ConferenceGlance = { median: round(quantile(vals, 0.5)), min: vals[0], max: vals[vals.length - 1], n: vals.length };
        row.glance[g.key] = gl;
      }
    }
    rows.push(row);
  }
  rows.sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.name.localeCompare(b.name));
  unaffiliated.sort((a, b) => a.name.localeCompare(b.name));

  // Membership years: the conference series' span across the site's colleges.
  let mFrom = Infinity;
  let mTo = -Infinity;
  for (const m of all) {
    const s = m.h.series.conference;
    if (!s) continue;
    mFrom = Math.min(mFrom, s.start);
    mTo = Math.max(mTo, s.start + s.values.length - 1);
  }
  const perYear = new Map<number, number>();
  for (const m of all) for (const mv of conferenceMoves(m.h)) if (!mv.football) perYear.set(mv.year, (perYear.get(mv.year) ?? 0) + 1);

  const apps = byKey("applicants");
  const file: ConferencesFile = {
    name: NAME,
    built: ctx.hmeta.built,
    yearKind: "fall",
    from: apps.from,
    to: apps.to,
    n: rows.reduce((s, r) => s + r.members.length, 0),
    floor: CONFERENCE_FLOOR,
    coverage: CONFERENCE_COVERAGE,
    membership: { from: mFrom, to: mTo },
    measures,
    glance,
    conferences: rows,
    unaffiliated,
    movesPerYear: [...perYear].sort((a, b) => a[0] - b[0]).map(([year, moves]) => ({ year, moves })),
  };
  return { name: NAME, file };
}

export const conferences: TrendBuilder = { name: NAME, build: buildConferences };
