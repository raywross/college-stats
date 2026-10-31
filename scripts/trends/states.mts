/**
 * Trends by state (specs/trends/states.md): per state, panel ids, yearly medians per measure (all, public, private
 * nonprofit), totals, panel-of-N counts, the state's movers, public R1/R2 ten-year changes, top sending states from
 * the residence detail, and (the 2026-10-12 addition) first-years crossing state lines, into
 * data/history/trends/states.json.
 *
 * Panel: the same 300-undergrad-both-ends floor as Study 3 (shrinking colleges), so the two studies' panels match.
 * States relax the 30-college grouping floor to STATE_FLOOR (10) for the state's own page (hub rule, owner
 * assumption): states under it get counts, their member list, and movers only (rule 1 of the spec).
 */
import { DIVERSITY_MIN_UNDERGRADS, real, type CpiTable } from "../../lib/history.ts";
import type { SeriesKey } from "../../lib/history.ts";
import { STATE_FLOOR } from "../../lib/trend-groups.ts";
import { at, byGroup, fixedPanel, medianBy, nationalRow, reporting, round4, shareBy, totalBy, yearly, type Member } from "../../lib/trend-panel.ts";
import { campusExclusionOf, exclusionSets, type MoverExclusionSets } from "../../lib/movers.ts";
import { stateByPostal } from "../../lib/states.ts";
import type { StateEntry, StateFlows, StateMapMeasures, StateMeasures, StateOutOfState, StateOutOfStateSide, StateResearchUni, StateSparkLines, StateTopSendingState, StatesFile } from "../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "./context.mts";
import { contextExclusions, moversFor } from "./movers.mts";

/** The five colleges in a state taking the most of its inflow (flows rule). */
const RECEIVING_SHOWN = 5;

const NAME = "states";
/** Same floor as Study 3's fixed panel, so the two studies describe the same colleges. */
export const MIN_UNDERGRADS = DIVERSITY_MIN_UNDERGRADS;
const WINDOW = 10;
/** Out-of-state share is collected in even falls only (lib/history.ts `ef-c`). */
const OOS_STEP = 2;

/** A college's % change in `key` from `from` to `to`; real dollars (to-year) when `cpi` is given. Null unless both report. */
function pctChangeOf(m: Member, key: SeriesKey, from: number, to: number, cpi?: CpiTable): number | null {
  let a = at(m, key, from);
  const b = at(m, key, to);
  if (a === null || b === null || a === 0) return null;
  if (cpi) {
    const r = real(a, from, cpi, to);
    if (r === null) return null;
    a = r;
  }
  return round4((b - a) / a);
}

/** A college's points change in `key` (a share series) from `from` to `to`. */
function ptsChangeOf(m: Member, key: SeriesKey, from: number, to: number): number | null {
  const a = at(m, key, from);
  const b = at(m, key, to);
  return a === null || b === null ? null : round4(b - a);
}

/**
 * Yearly median of `key` over `ms`'s reporting colleges, `from` to `to`; real (to-year) dollars when `cpi` is given.
 * `requireCoverage` gates a year on MIN_YEAR_COVERAGE (90%) of `ms`, as the fall admissions/enrollment series report
 * almost universally within a 300-undergrad panel; `avg_paid_all` (an academic-year money series) reports more
 * unevenly even within that panel (price-gap.mts's yearly lines don't gate on it either), so its line is false here:
 * every year's actual reporters, not held to 90%.
 */
function medianLine(ms: readonly Member[], key: SeriesKey, from: number, to: number, cpi?: CpiTable, step = 1, requireCoverage = true): (number | null)[] {
  return yearly(
    from,
    to,
    (y) => {
      const r = requireCoverage ? reporting(ms, (m) => at(m, key, y) !== null) : ms.filter((m) => at(m, key, y) !== null);
      if (!r || !r.length) return null;
      const v = medianBy(r, (m) => {
        const raw = at(m, key, y);
        if (raw === null) return null;
        return cpi ? real(raw, y, cpi, to) : raw;
      });
      return v === null ? null : round4(v);
    },
    step
  );
}

/**
 * One group's (or the nation's) measures over the window, over its fixed panel. `avg_paid_all` is an "academic"
 * series (academic year, one behind `fall`'s latest), so it gets its own window end (`toMoney`/`fromMoney`) rather
 * than the fall window's `to` — using `to` left every college's cost null (no college reports a fall year as an
 * academic year) and the median silently fell back to 0.
 */
function measuresOf(ms: readonly Member[], from: number, to: number, fromMoney: number, toMoney: number, cpi: CpiTable): StateMeasures {
  const thenTotal = totalBy(ms, (m) => at(m, "undergrads", from)) ?? 0;
  const nowTotal = totalBy(ms, (m) => at(m, "undergrads", to)) ?? 0;
  return {
    undergradsMedianChange: round4(medianBy(ms, (m) => pctChangeOf(m, "undergrads", from, to)) ?? 0),
    undergradsTotal: [Math.round(thenTotal), Math.round(nowTotal)],
    undergradsTotalChange: thenTotal ? round4((nowTotal - thenTotal) / thenTotal) : 0,
    applicantsMedianChange: round4(medianBy(ms, (m) => pctChangeOf(m, "applicants", from, to)) ?? 0),
    acceptanceRateMedianChange: round4(medianBy(ms, (m) => ptsChangeOf(m, "acceptance_rate", from, to)) ?? 0),
    avgPaidMedianChange: round4(medianBy(ms, (m) => pctChangeOf(m, "avg_paid_all", fromMoney, toMoney, cpi)) ?? 0),
  };
}

function sparkLinesOf(ms: readonly Member[], from: number, to: number, fromMoney: number, toMoney: number, cpi: CpiTable): StateSparkLines {
  return {
    undergrads: medianLine(ms, "undergrads", from, to),
    applicants: medianLine(ms, "applicants", from, to),
    acceptanceRate: medianLine(ms, "acceptance_rate", from, to),
    avgPaid: medianLine(ms, "avg_paid_all", fromMoney, toMoney, cpi, 1, false),
  };
}

function outOfStateSideOf(ms: readonly Member[], from: number, to: number): StateOutOfStateSide | null {
  const thenMed = medianBy(ms, (m) => at(m, "out_of_state_share", from));
  const toMed = medianBy(ms, (m) => at(m, "out_of_state_share", to));
  if (thenMed === null || toMed === null) return null;
  return { n: ms.length, line: medianLine(ms, "out_of_state_share", from, to, undefined, OOS_STEP), thenNow: [round4(thenMed), round4(toMed)] };
}

function outOfStateOf(stateMembers: readonly Member[], from: number, to: number): StateOutOfState {
  return {
    from,
    to,
    lineFrom: from,
    public: outOfStateSideOf(stateMembers.filter((m) => m.school.type === "public"), from, to),
    privateNonprofit: outOfStateSideOf(stateMembers.filter((m) => m.school.type === "private-nonprofit"), from, to),
  };
}

/** Top sending states to this state's colleges, summed from each college's home-state table (snapshot, newest year). */
function topSendingStatesOf(ctx: TrendContext, stateMembers: readonly Member[], n = 8): StateTopSendingState[] {
  const totals = new Map<string, number>();
  let total = 0;
  for (const m of stateMembers) {
    const rows = ctx.detail(m.school.unit_id)?.tables.home_states?.rows;
    if (!rows) continue;
    for (const [postal, count] of Object.entries(rows)) {
      totals.set(postal, (totals.get(postal) ?? 0) + count);
      total += count;
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([state, count]) => ({ state, count, share: total ? round4(count / total) : 0 }));
}

/** This state's public R1 and R2 universities (Carnegie 2025), with their ten-year undergraduate change. */
function researchUnisOf(stateMembers: readonly Member[], from: number, to: number): StateResearchUni[] {
  const out: StateResearchUni[] = [];
  for (const m of stateMembers) {
    const tier = m.school.campus?.carnegie?.research;
    if (m.school.type !== "public" || (tier !== "R1" && tier !== "R2")) continue;
    out.push({ unit_id: m.school.unit_id, name: m.school.name, tier, from, to, change: pctChangeOf(m, "undergrads", from, to) });
  }
  return out.sort((a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier === "R1" ? -1 : 1));
}

const TEST_OPTIONAL = new Set(["recommended", "considered", "not-considered"]);

function mapMeasuresOf(stateMembers: readonly Member[], undergradChange: number | null): Omit<StateMapMeasures, "netInflow"> {
  const acceptanceRate = medianBy(stateMembers, (m) => m.school.admissions.acceptance_rate);
  const avgCost = medianBy(stateMembers, (m) => m.school.cost?.avg_paid_all ?? null);
  const outOfState = medianBy(
    stateMembers.filter((m) => m.school.type === "public"),
    (m) => m.school.demographics.residence?.out_of_state ?? null
  );
  const testOptionalShare = shareBy(stateMembers, (m) => {
    const tp = m.school.admissions.test_policy;
    return tp === undefined ? null : TEST_OPTIONAL.has(tp ?? "");
  });
  return {
    undergradChange,
    acceptanceRate: acceptanceRate === null ? null : round4(acceptanceRate),
    avgCost: avgCost === null ? null : Math.round(avgCost),
    outOfState: outOfState === null ? null : round4(outOfState),
    testOptionalShare: testOptionalShare === null ? null : round4(testOptionalShare),
  };
}

/** "Fall 2024" (the detail table's own year string, written from meta.vintages["ipeds-ef-c"]) → 2024. */
function parseFlowsYear(ctx: TrendContext): number | null {
  for (const m of ctx.members) {
    const y = ctx.detail(m.school.unit_id)?.tables.home_states?.year;
    const match = y?.match(/\d{4}/);
    if (match) return Number(match[0]);
  }
  return null;
}

interface FlowAgg {
  inState: number;
  inflow: number;
  outflow: number;
  other: number;
  n: number;
  receiving: { unit_id: string; name: string; count: number }[];
}

/**
 * First-years crossing state lines (specs/trends/states.md, "Planned addition" — built 2026-10-12): summed from
 * every campus-based college's home-state table for the one snapshot fall `year`. Rule 1: for-profit, online-first
 * (at that one fall; `campusExclusionOf` with the same year at both ends), and closed-or-merged colleges are left
 * out entirely (`excluded`, for the method note). Rule 3: a home code that isn't a recognized state (foreign,
 * unknown) or a state with no counted college on the site is left out of inflow/outflow and folded into the
 * *sending* college's `other` instead — so every unit added to one state's inflow is matched by an equal unit added
 * to another state's outflow, and `Σ inflow = Σ outflow` exactly. Rule 5: no floor; a state's entry is omitted only
 * when none of its own colleges have a counted table (`statesWithTable`).
 */
export function allFlowsOf(ctx: TrendContext, year: number, campuses: MoverExclusionSets["campuses"]): { byState: Map<string, StateFlows>; excluded: { onlineFirst: number; forProfit: number; campuses: number } } {
  const excluded = { onlineFirst: 0, forProfit: 0, campuses: 0 };
  const counted: { m: Member; state: string; rows: Record<string, number> }[] = [];
  const statesWithTable = new Set<string>();
  for (const m of ctx.members) {
    const rows = ctx.detail(m.school.unit_id)?.tables.home_states?.rows;
    if (!rows) continue;
    const reason = campusExclusionOf(m, year, year, campuses);
    if (reason === "online-first") {
      excluded.onlineFirst++;
      continue;
    }
    if (reason === "for-profit") {
      excluded.forProfit++;
      continue;
    }
    if (reason === "closed-or-merged") {
      excluded.campuses++;
      continue;
    }
    const state = m.school.location.state;
    if (!state) continue;
    counted.push({ m, state, rows });
    statesWithTable.add(state);
  }

  const agg = new Map<string, FlowAgg>();
  const ensure = (postal: string): FlowAgg => agg.get(postal) ?? agg.set(postal, { inState: 0, inflow: 0, outflow: 0, other: 0, n: 0, receiving: [] }).get(postal)!;

  for (const { m, state, rows } of counted) {
    const total = m.school.demographics.residence?.first_years ?? Object.values(rows).reduce((a, b) => a + b, 0);
    const inState = rows[state] ?? 0;
    let outOfState = 0;
    for (const [postal, count] of Object.entries(rows)) {
      if (postal === state || !statesWithTable.has(postal)) continue;
      outOfState += count;
      ensure(postal).outflow += count;
    }
    const a = ensure(state);
    a.inState += inState;
    a.inflow += outOfState;
    a.n += 1;
    a.other += Math.max(0, total - inState - outOfState);
    if (outOfState > 0) a.receiving.push({ unit_id: m.school.unit_id, name: m.school.name, count: outOfState });
  }

  const byState = new Map<string, StateFlows>();
  for (const [postal, a] of agg) {
    if (a.n === 0) continue; // every entry here came through `counted`/`statesWithTable`, so this never triggers.
    const firstYears = a.inState + a.inflow;
    const net = a.inflow - a.outflow;
    const receiving = a.receiving
      .sort((x, y) => y.count - x.count || x.unit_id.localeCompare(y.unit_id))
      .slice(0, RECEIVING_SHOWN)
      .map((r) => ({ unit_id: r.unit_id, name: r.name, count: r.count, share: a.inflow ? round4(r.count / a.inflow) : 0 }));
    byState.set(postal, {
      year,
      inflow: a.inflow,
      outflow: a.outflow,
      net,
      firstYears,
      netShare: firstYears ? round4(net / firstYears) : 0,
      other: a.other,
      n: a.n,
      receiving,
    });
  }
  return { byState, excluded };
}

function buildState(
  ctx: TrendContext,
  postal: string,
  stateMembers: readonly Member[],
  from: number,
  to: number,
  fromMoney: number,
  toMoney: number,
  flows: StateFlows | undefined
): StateEntry {
  const info = stateByPostal(postal);
  const onSite = {
    total: stateMembers.length,
    public: stateMembers.filter((m) => m.school.type === "public").length,
    privateNonprofit: stateMembers.filter((m) => m.school.type === "private-nonprofit").length,
    privateForprofit: stateMembers.filter((m) => m.school.type === "private-forprofit").length,
  };
  const windows10 = moversFor(ctx, stateMembers, ["applications-surged", "grew-most", "pay-less"], [10], 10);
  const base: Pick<StateEntry, "postal" | "name" | "territory" | "onSite" | "members" | "topSendingStates" | "researchUnis" | "movers"> = {
    postal,
    name: info?.name ?? postal,
    territory: !(info?.state ?? true),
    onSite,
    members: [...stateMembers].map((m) => ({ unit_id: m.school.unit_id, name: m.school.name })).sort((a, b) => a.name.localeCompare(b.name)),
    topSendingStates: topSendingStatesOf(ctx, stateMembers),
    researchUnis: researchUnisOf(stateMembers, from, to),
    movers: windows10,
  };

  if (onSite.total < STATE_FLOOR) {
    return {
      ...base,
      panel: { n: 0, ids: [] },
      tooFew: true,
      map: { undergradChange: null, acceptanceRate: null, avgCost: null, outOfState: null, testOptionalShare: null, netInflow: flows?.netShare ?? null },
      flows,
    };
  }

  const panel = fixedPanel(stateMembers, [from, to], (m, y) => (at(m, "undergrads", y) ?? 0) >= MIN_UNDERGRADS);
  const all = nationalRow(panel, (ms) => measuresOf(ms, from, to, fromMoney, toMoney, ctx.cpi));
  const control = byGroup(panel, "control", (ms) => measuresOf(ms, from, to, fromMoney, toMoney, ctx.cpi), STATE_FLOOR);

  return {
    ...base,
    panel: { n: panel.length, ids: panel.map((m) => m.school.unit_id).sort() },
    map: { ...mapMeasuresOf(stateMembers, all.values!.undergradsMedianChange), netInflow: flows?.netShare ?? null },
    all,
    control,
    sparkLines: sparkLinesOf(panel, from, to, fromMoney, toMoney, ctx.cpi),
    outOfState: outOfStateOf(stateMembers, from, to),
    flows,
  };
}

export function buildStates(ctx: TrendContext): TrendOutput {
  const to = ctx.hmeta.latest.fall;
  const from = to - WINDOW;
  const toMoney = ctx.hmeta.latest.academic;
  const fromMoney = toMoney - WINDOW;
  const byState = new Map<string, Member[]>();
  for (const m of ctx.members) {
    const postal = m.school.location.state;
    if (!postal) continue;
    byState.set(postal, [...(byState.get(postal) ?? []), m]);
  }

  // First-years crossing state lines (specs/trends/states.md, "Planned addition"): one snapshot fall, the detail
  // files' newest year, over campus-based colleges only (rule 1).
  const flowsYear = parseFlowsYear(ctx);
  const campuses = exclusionSets(contextExclusions(ctx)).campuses;
  const { byState: flowsByState, excluded: flowsExcluded } = flowsYear === null ? { byState: new Map<string, StateFlows>(), excluded: { onlineFirst: 0, forProfit: 0, campuses: 0 } } : allFlowsOf(ctx, flowsYear, campuses);

  const states = [...byState.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([postal, ms]) => buildState(ctx, postal, ms, from, to, fromMoney, toMoney, flowsByState.get(postal)));

  // The "national median" comparison line uses the same 300-undergrad fixed panel as every state's own panel
  // (not every college on the site): the raw, unfiltered universe includes hundreds of open-admission and very
  // small colleges that don't report applicants or cost most years, which pushed every national line's coverage
  // under MIN_YEAR_COVERAGE and left it entirely null.
  const nationalPanel = fixedPanel(ctx.members, [from, to], (m, y) => (at(m, "undergrads", y) ?? 0) >= MIN_UNDERGRADS);

  const file: StatesFile = {
    name: NAME,
    built: ctx.hmeta.built,
    yearKind: "fall",
    from,
    to,
    n: ctx.members.length,
    floor: STATE_FLOOR,
    lineFrom: from,
    fromMoney,
    toMoney,
    national: {
      sparkLines: sparkLinesOf(nationalPanel, from, to, fromMoney, toMoney, ctx.cpi),
      outOfStatePublicLine: medianLine(
        nationalPanel.filter((m) => m.school.type === "public"),
        "out_of_state_share",
        from,
        to,
        undefined,
        OOS_STEP
      ),
    },
    flowsYear,
    flowsRule: { excluded: flowsExcluded },
    states,
  };
  return { name: NAME, file };
}

export const states: TrendBuilder = { name: NAME, build: buildStates };
