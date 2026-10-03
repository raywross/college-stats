import { getData } from "@/lib/data";
import type { School } from "@/lib/types";
import { DOMAINS } from "@/lib/metrics";
import { pct } from "@/lib/format";
import { AID_GROUP_LABELS, MIN_GROUP_COHORT, RACE_GROUPS, RACE_GROUP_LABELS, MAX_PLAUSIBLE_GAP, gapPhrase, hasGradByGroup, pellGap, rawPellGap } from "@/lib/graduation-groups";
import { GroupDotPlot, type GroupDotRow } from "@/components/charts/GroupDotPlot";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";

export { hasGradByGroup };

/** One sentence: "Pell Grant recipients: 89%, 5 points below students with no need-based aid." */
export function pellGapSentence(s: School): string | null {
  const o = s.outcomes;
  const gap = pellGap(s);
  if (gap === null || o?.grad_rate_pell == null || o.grad_rate_no_pell_no_loan == null) return null;
  const rel = gapPhrase(o.grad_rate_pell, o.grad_rate_no_pell_no_loan);
  return `Pell Grant recipients: ${pct(o.grad_rate_pell)}, ${rel} students with no need-based federal aid (${pct(o.grad_rate_no_pell_no_loan)}).`;
}

/**
 * Graduation by group on the profile's Cost & outcomes section (specs/data-expansion/graduation-by-group.md): Pell
 * and loan status from IPEDS, race/ethnicity from the College Scorecard, each cited on its own (different sources,
 * so never one sentence across both).
 */
export async function GraduationByGroup({ school }: { school: School }) {
  const { citeField } = await getData();
  const o = school.outcomes;
  if (!o || !hasGradByGroup(school)) return null;
  const color = DOMAINS.access.color;
  const neither = o.grad_rate_no_pell_no_loan ?? null;
  const pellCited = citeField("outcomes.grad_rate_pell", school);
  const raceCited = citeField("outcomes.grad_rate_by_race", school);
  // 4-year shares from the college's CDS (specs/data-expansion/cds-student-body-and-outcomes.md), stored only beside
  // six-year rates of the same class. The race plot stays on Scorecard's class, so its overall line is the federal one.
  const within4 = school.reported?.outcomes?.graduation?.within_4 ?? null;
  const fedGrad = o.federal?.graduation ?? null;
  const fedGradCited = citeField("outcomes.federal.graduation", school);
  const onTimeCited = citeField("reported.outcomes.graduation", school);
  const vsNeither = (v: number | null | undefined) => (v != null && neither !== null ? `${gapPhrase(v, neither)} students with neither` : undefined);

  const aidRows: GroupDotRow[] = [
    { key: "pell", label: AID_GROUP_LABELS.pell, value: o.grad_rate_pell ?? null, cohort: o.grad_cohorts?.pell ?? null, note: vsNeither(o.grad_rate_pell), secondary: within4?.pell },
    { key: "loan", label: AID_GROUP_LABELS.loan_no_pell, value: o.grad_rate_loan_no_pell ?? null, cohort: o.grad_cohorts?.loan_no_pell ?? null, note: vsNeither(o.grad_rate_loan_no_pell), secondary: within4?.loan_no_pell },
    { key: "neither", label: AID_GROUP_LABELS.no_pell_no_loan, value: neither, cohort: o.grad_cohorts?.no_pell_no_loan ?? null, reference: true, note: neither !== null ? "comparison group" : undefined, secondary: within4?.no_pell_no_loan },
  ];
  const overall = o.grad_rate_ftft ?? null;
  const raceOverall = fedGrad ? fedGrad.grad_rate_ftft : overall;
  const raceOverallYear = fedGrad ? fedGradCited.year : pellCited.year;
  // "Of 100 Pell Grant recipients who entered in fall 2019, 78 finished within 4 years and 89 within 6."
  const enteredIn = onTimeCited.year?.replace(/^Entered /, "").toLowerCase() ?? null;
  const onTimeSentence =
    within4?.pell != null && o.grad_rate_pell != null && enteredIn
      ? `Of 100 Pell Grant recipients who entered in ${enteredIn}, ${Math.round(within4.pell * 100)} finished within 4 years and ${Math.round(o.grad_rate_pell * 100)} within 6.`
      : null;
  const raceRows: GroupDotRow[] = RACE_GROUPS.filter((g) => (o.grad_cohorts_by_race?.[g] ?? 0) > 0).map((g) => {
    const v = o.grad_rate_by_race?.[g] ?? null;
    return { key: g, label: RACE_GROUP_LABELS[g], value: v, cohort: o.grad_cohorts_by_race?.[g] ?? null, note: v !== null && overall !== null ? `${gapPhrase(v, overall)} all students` : undefined };
  });
  const hasAid = o.grad_rate_pell != null || neither !== null;
  const hasRace = raceRows.some((r) => r.value !== null);
  const sentence = pellGapSentence(school);
  const implausible = rawPellGap(school) !== null && pellGap(school) === null;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {hasAid && (
        <div className="rounded-3xl border bg-card p-4 sm:p-6">
          <h3 className="mb-1 flex items-center gap-1 font-display text-lg font-bold">
            Do lower-income students finish? <InfoTip term="pell-graduation-gap" cited={pellCited} />
          </h3>
          <p className="mb-4 text-xs text-muted-foreground">
            {onTimeSentence ? `${onTimeSentence} ` : sentence ? `${sentence} ` : ""}
            First-time, full-time students who finished within 6 years
            {pellCited.year ? `; ${pellCited.year.toLowerCase()}` : ""}.
          </p>
          <GroupDotPlot
            label="Graduation rate by Pell Grant and loan status"
            rows={aidRows}
            overall={overall !== null ? { label: "All students in this class", value: overall } : null}
            color={color}
          />
          {within4 && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-2.5 rounded-full opacity-40" style={{ backgroundColor: color }} aria-hidden />
              <MetricLabel term="on-time-graduation" cited={onTimeCited}>
                Within 4 years
              </MetricLabel>
            </p>
          )}
          {implausible && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              These groups&apos; rates are more than {Math.round(MAX_PLAUSIBLE_GAP * 100)} points apart, which usually means the college sorted
              students into the groups inconsistently in its federal report. Shown as reported; treat the difference with caution.
            </p>
          )}
        </div>
      )}
      {hasRace && (
        <div className="rounded-3xl border bg-card p-4 sm:p-6">
          <h3 className="mb-1 flex items-center gap-1 font-display text-lg font-bold">
            <MetricLabel term="graduation-rate" cited={raceCited} className="font-display text-lg font-bold">
              By race and ethnicity
            </MetricLabel>
          </h3>
          <p className="mb-4 text-xs text-muted-foreground">
            First-time, full-time students who finished within 6 years, from the College Scorecard
            {raceCited.year ? `, ${raceCited.year}` : "'s most recent release"}. Groups under {MIN_GROUP_COHORT} students aren&apos;t shown.
          </p>
          <GroupDotPlot
            label="Graduation rate by race and ethnicity"
            rows={raceRows}
            overall={raceOverall !== null ? { label: `All students (IPEDS${raceOverallYear ? `, ${raceOverallYear.toLowerCase()}` : ""})`, value: raceOverall } : null}
            color={color}
          />
        </div>
      )}
    </div>
  );
}
