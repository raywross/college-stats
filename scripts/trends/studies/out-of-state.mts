/**
 * Study 5: public colleges and students from other states (specs/trends/out-of-state.md).
 *
 * Panel: public colleges reporting the out-of-state share in both the window's first and last even fall, with 200+
 * enrolled first-years in the first fall (residence is collected only in even-numbered falls: `lib/history.ts`
 * `seriesStep`, family `ef-c`). Private nonprofits appear only as a context line (not a fixed panel): the study is
 * about publics, because the question is about publics. Share of colleges, not students, except the weighted
 * companion and the "students" view.
 */
import { real } from "../../../lib/history.ts";
import { pct } from "../../../lib/format.ts";
import { control } from "../../../lib/trend-groups.ts";
import { at, byGroup, medianBy, nationalRow, reporting, round4, shareBy, weightedBy, yearly, type Member } from "../../../lib/trend-panel.ts";
import { studyBySlug, studyWindow } from "../../../lib/trend-studies.ts";
import type { OutOfStateFile, OutOfStateValues, ThenNow } from "../../../lib/trends.ts";
import type { TrendBuilder, TrendContext, TrendOutput } from "../context.mts";

const SLUG = "out-of-state";
/** Enrolled first-years a public college needs, in the window's first fall, to join the panel. */
export const MIN_ENROLLED = 200;
/** "30%+ out-of-state" bar (the spec's second panel, and "known for: draws students nationally" territory). */
export const THRESHOLD_30 = 0.3;
/** The out-of-state premium (in `to`-year dollars) a college needs to exceed for the "over $20,000" share. */
export const PREMIUM_OVER = 20_000;

const roundMoney = (v: number) => Math.round(v);

const inPanel = (m: Member, from: number, to: number) =>
  control(m.school) === "public" && at(m, "out_of_state_share", from) !== null && at(m, "out_of_state_share", to) !== null && (at(m, "enrolled", from) ?? 0) >= MIN_ENROLLED;

export function outOfStatePanel(members: readonly Member[], [from, to]: [number, number]): Member[] {
  return members.filter((m) => inPanel(m, from, to));
}

/** One group's (or the nation's) values over its panel members. */
export function values(ms: readonly Member[], [from, to]: [number, number], lineFrom: number): OutOfStateValues {
  const shareAt = (m: Member, y: number) => at(m, "out_of_state_share", y);
  const medianAt = (r: readonly Member[], y: number) => medianBy(r, (m) => shareAt(m, y));
  const share30At = (r: readonly Member[], y: number) => shareBy(r, (m) => (shareAt(m, y) ?? -1) >= THRESHOLD_30);
  const weightedAt = (r: readonly Member[], y: number) => weightedBy(r, (m) => shareAt(m, y), (m) => at(m, "enrolled", y));
  const ends = (f: (r: readonly Member[], y: number) => number | null): ThenNow => [round4(f(ms, from)!), round4(f(ms, to)!)];
  const hasShare = (m: Member, y: number) => shareAt(m, y) !== null;
  const hasWeight = (m: Member, y: number) => hasShare(m, y) && (at(m, "enrolled", y) ?? 0) > 0;
  /** A yearly line over the members reporting that year (null under 90% coverage, and on odd years: step 2). */
  const line = (ok: (m: Member, y: number) => boolean, f: (r: readonly Member[], y: number) => number | null) =>
    yearly(
      lineFrom,
      to,
      (y) => {
        const r = reporting(ms, (m) => ok(m, y));
        return r ? round4(f(r, y)) : null;
      },
      2
    );
  return {
    medianShare: ends(medianAt),
    share30: ends(share30At),
    weightedShare: ends(weightedAt),
    lines: {
      medianShare: line(hasShare, medianAt),
      share30: line(hasShare, share30At),
      weightedShare: line(hasWeight, weightedAt),
    },
  };
}

export function buildOutOfState(ctx: TrendContext): TrendOutput {
  const study = studyBySlug(SLUG)!;
  const window = studyWindow(study, ctx.hmeta.latest);
  const [from, to] = window;
  // The line starts at the first fall any college's out-of-state series exists (fall 2004, the family's start).
  const lineFrom = Math.min(...ctx.members.flatMap((m) => (m.h.series.out_of_state_share ? [m.h.series.out_of_state_share.start] : [])));
  const panel = outOfStatePanel(ctx.members, window);
  const compute = (ms: Member[]) => values(ms, window, lineFrom);

  // Context line: private nonprofits' median out-of-state share, not a fixed panel of its own (hub rule: the study is
  // about publics) — reported each even year, over whichever private nonprofits report that year.
  const privatePanel = ctx.members.filter((m) => control(m.school) === "private-nonprofit" && at(m, "out_of_state_share", from) !== null && at(m, "out_of_state_share", to) !== null);
  const privateMedianAt = (y: number) => medianBy(privatePanel, (m) => at(m, "out_of_state_share", y));
  const privateLine = yearly(
    lineFrom,
    to,
    (y) => {
      const r = reporting(privatePanel, (m) => at(m, "out_of_state_share", y) !== null);
      return r ? round4(medianBy(r, (m) => at(m, "out_of_state_share", y))!) : null;
    },
    2
  );
  const privateMedianFrom = privateMedianAt(from);
  const privateMedianTo = privateMedianAt(to);
  if (privateMedianFrom === null || privateMedianTo === null) throw new Error("build-trends: out-of-state private context is missing data");
  const privateMedian: ThenNow = [round4(privateMedianFrom), round4(privateMedianTo)];

  // Companion: students from abroad, median public, same panel.
  const internationalMedian: ThenNow = [round4(medianBy(panel, (m) => at(m, "international_share", from))!), round4(medianBy(panel, (m) => at(m, "international_share", to))!)];

  // The out-of-state premium: full price out-of-state minus in-state, in `premiumTo`-year dollars. Prices are an
  // academic-year series and the newest one lags the newest fall (sticker prices: through academic year
  // ctx.hmeta.latest.academic, one year behind ctx.hmeta.latest.fall), so this uses its own window rather than `to`.
  const premiumTo = ctx.hmeta.latest.academic;
  const premiumFrom = premiumTo - study.window;
  const premiumAt = (m: Member, y: number): number | null => {
    const inState = at(m, "sticker_in_state", y);
    const outState = at(m, "sticker_out_of_state", y);
    return inState === null || outState === null ? null : real(outState - inState, y, ctx.cpi, premiumTo);
  };
  const premiumMedianAt = (y: number): number | null => medianBy(panel, (m) => premiumAt(m, y));
  const over20kAt = (y: number): number | null =>
    shareBy(panel, (m) => {
      const p = premiumAt(m, y);
      return p === null ? null : p > PREMIUM_OVER;
    });
  const premiumLine = yearly(lineFrom, premiumTo, (y) => {
    const r = reporting(panel, (m) => premiumAt(m, y) !== null);
    return r ? roundMoney(medianBy(r, (m) => premiumAt(m, y))!) : null;
  });
  const premiumMedianFrom = premiumMedianAt(premiumFrom);
  const premiumMedianTo = premiumMedianAt(premiumTo);
  const over20kFrom = over20kAt(premiumFrom);
  const over20kTo = over20kAt(premiumTo);
  if (premiumMedianFrom === null || premiumMedianTo === null || over20kFrom === null || over20kTo === null) {
    throw new Error(`build-trends: out-of-state premium is missing data for ${premiumFrom} or ${premiumTo}`);
  }

  // Where out-of-state first-years come from: summed from detail.residence (newest even fall only; the file has no
  // history), across every public college with the table, not just the fixed panel (a current snapshot, not a trend).
  const sendingTotals: Record<string, number> = {};
  let sendingN = 0;
  for (const m of ctx.members) {
    if (control(m.school) !== "public") continue;
    const rows = ctx.detail(m.school.unit_id)?.tables.home_states?.rows;
    if (!rows) continue;
    sendingN++;
    const own = m.school.location.state;
    for (const [st, count] of Object.entries(rows)) {
      if (st === own) continue;
      sendingTotals[st] = (sendingTotals[st] ?? 0) + count;
    }
  }
  const totals = Object.fromEntries(Object.keys(sendingTotals).sort().map((k) => [k, sendingTotals[k]]));

  const file: OutOfStateFile = {
    name: SLUG,
    slug: SLUG,
    built: ctx.hmeta.built,
    yearKind: study.yearKind,
    from,
    to,
    n: panel.length,
    lineFrom,
    minEnrolled: MIN_ENROLLED,
    threshold: THRESHOLD_30,
    private: { median: privateMedian, line: privateLine },
    internationalMedian,
    premium: {
      from: premiumFrom,
      to: premiumTo,
      lineFrom,
      line: premiumLine,
      median: [roundMoney(premiumMedianFrom), roundMoney(premiumMedianTo)],
      over20k: [round4(over20kFrom), round4(over20kTo)],
    },
    sendingStates: { year: to, totals, n: sendingN },
    national: nationalRow(panel, compute),
    groupings: study.groupings.map((g) => byGroup(panel, g, compute)),
  };
  const v = file.national.values!;
  return {
    name: SLUG,
    file,
    card: {
      slug: SLUG,
      title: study.title,
      headline: { value: v.medianShare[1], format: "pct", caption: "median public college's out-of-state share of first-years" },
      sentence:
        `The median public college's out-of-state share rose from ${pct(v.medianShare[0])} in fall ${from} to ${pct(v.medianShare[1])} in fall ${to}, ` +
        `and the share of publics that are 30%+ out-of-state rose from ${pct(v.share30[0])} to ${pct(v.share30[1])}.`,
      spark: {
        start: lineFrom,
        kind: "fall",
        format: "pct",
        series: [{ name: "Median public's out-of-state share", values: v.lines.medianShare }],
      },
      yearKind: "fall",
      from,
      to,
      n: panel.length,
    },
  };
}

export const outOfState: TrendBuilder = { name: SLUG, build: buildOutOfState };
