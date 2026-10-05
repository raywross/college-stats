/**
 * Trends by state (specs/trends/states.md): per state, panel ids, yearly medians per measure (all, public, private
 * nonprofit), totals, panel-of-N counts, the state's movers, public R1/R2 ten-year changes, and top sending states
 * from the residence detail, into data/history/trends/states.json.
 *
 * Panel: the same 300-undergrad-both-ends floor as Study 3 (shrinking colleges), so the two studies' panels match.
 * States relax the 30-college grouping floor to STATE_FLOOR (10) for the state's own page (hub rule, owner
 * assumption): states under it get counts, their member list, and movers only (rule 1 of the spec).
 */
import { DIVERSITY_MIN_UNDERGRADS, real, type CpiTable } from "../../lib/history.ts";
import type { SeriesKey } from "../../lib/history.ts";
import { STATE_FLOOR } from "../../lib/trend-groups.ts";
import { at, byGroup, fixedPanel, medianBy, nationalRow, reporting, round4, shareBy, totalBy, yearly, type Member } from "../../lib/trend-panel.ts";
import { stateByPostal } from "../../lib/states.ts";
import type { StateEntry, StateMapMeasures, StateMeasures, StateOutOfState, StateOutOfStateSide, StateResearchUni, StateSparkLines, StateTopSendingState, StatesFile } from "../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "./context.mts";
import { moversFor } from "./movers.mts";

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

function mapMeasuresOf(stateMembers: readonly Member[], undergradChange: number | null): StateMapMeasures {
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

function buildState(
  ctx: TrendContext,
  postal: string,
  stateMembers: readonly Member[],
  from: number,
  to: number,
  fromMoney: number,
  toMoney: number
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
    return { ...base, panel: { n: 0, ids: [] }, tooFew: true, map: { undergradChange: null, acceptanceRate: null, avgCost: null, outOfState: null, testOptionalShare: null } };
  }

  const panel = fixedPanel(stateMembers, [from, to], (m, y) => (at(m, "undergrads", y) ?? 0) >= MIN_UNDERGRADS);
  const all = nationalRow(panel, (ms) => measuresOf(ms, from, to, fromMoney, toMoney, ctx.cpi));
  const control = byGroup(panel, "control", (ms) => measuresOf(ms, from, to, fromMoney, toMoney, ctx.cpi), STATE_FLOOR);

  return {
    ...base,
    panel: { n: panel.length, ids: panel.map((m) => m.school.unit_id).sort() },
    map: mapMeasuresOf(stateMembers, all.values!.undergradsMedianChange),
    all,
    control,
    sparkLines: sparkLinesOf(panel, from, to, fromMoney, toMoney, ctx.cpi),
    outOfState: outOfStateOf(stateMembers, from, to),
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
  const states = [...byState.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([postal, ms]) => buildState(ctx, postal, ms, from, to, fromMoney, toMoney));

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
    states,
  };
  return { name: NAME, file };
}

export const states: TrendBuilder = { name: NAME, build: buildStates };
