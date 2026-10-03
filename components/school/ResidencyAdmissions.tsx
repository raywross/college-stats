import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { admissionsByResidency, type ResidencyRateGroup } from "@/lib/cds/residency-display";
import { pctSmart } from "@/lib/format";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";

const RATE_FIELD: Record<ResidencyRateGroup, FieldPath> = {
  in_state: "derived.admit_rate_in_state",
  out_of_state: "derived.admit_rate_out_of_state",
  international: "derived.admit_rate_international",
};

/**
 * "Where applicants live" (specs/data-expansion/cds-residency-admissions.md): acceptance rates of applicants from the
 * college's state, other states, and abroad, from the college's Common Data Set C1 grid, with a tick for all applicants
 * in the same class, the yield line, and the caveat. When the gap isn't notable, one line instead (placed under the
 * funnel by `variant="line"`). Renders nothing without in-state and out-of-state rates.
 */
export function ResidencyAdmissions({
  school,
  cite,
  color,
  variant,
  studentState,
  id,
}: {
  school: School;
  /** citeField bound to the dataset (server only). */
  cite: (path: FieldPath, school?: School) => Cited;
  color: string;
  /** "card": the notable card (renders only when notable); "line": the one-line fallback (only when not notable). */
  variant: "card" | "line";
  /** The signed-in student's state ("outside-us" for abroad), for the "(you)" marker; omitted signed out. */
  studentState?: string | null;
  id?: string;
}) {
  const r = admissionsByResidency(school, studentState);
  if (!r) return null;
  const rateCited = cite("derived.admit_rate_in_state", school);

  if (variant === "line") {
    if (r.notable) return null;
    return (
      <p id={id} className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        {r.sentence} <InfoTip term="admit-rate-by-residency" cited={rateCited} />
      </p>
    );
  }
  if (!r.notable) return null;

  const label: Record<ResidencyRateGroup, string> = { in_state: `From ${r.state}`, out_of_state: "From other states", international: "From abroad" };
  const allCited = cite("derived.admit_rate_same_class", school);

  return (
    <div id={id} className="scroll-mt-24 rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-1 flex items-center gap-1 font-display text-lg font-bold">
        Where applicants live <InfoTip term="admit-rate-by-residency" cited={rateCited} />
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">{r.sentence}</p>
      <div className="space-y-3">
        {r.shown.map((g) => {
          const v = r.rates[g]!;
          const you = r.you === g;
          return (
            <div key={g} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <MetricLabel cited={cite(RATE_FIELD[g], school)} className="text-xs font-medium">
                  {label[g]}
                  {you && " (you)"}
                </MetricLabel>
                <span className="text-sm font-semibold tabular-nums">{pctSmart(v)}</span>
              </div>
              <div className="relative">
                <div className="relative h-2 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)` }}>
                  <div
                    className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full"
                    style={{ width: `${Math.max(0, Math.min(100, v * 100))}%`, backgroundColor: you || r.you === null ? color : `color-mix(in oklch, ${color} 55%, transparent)` }}
                  />
                </div>
                {r.all !== null && (
                  <div className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${Math.min(100, r.all * 100)}%` }} aria-hidden />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {r.all !== null && (
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block h-2.5 w-0.5 translate-y-0.5 rounded-full bg-foreground" aria-hidden />
          <MetricLabel cited={allCited}>
            All applicants in the same class: <span className="font-medium text-foreground">{pctSmart(r.all)}</span>
          </MetricLabel>
        </p>
      )}
      {r.yieldSentence && (
        <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          {r.yieldSentence} <InfoTip term="yield-by-residency" cited={cite("derived.yield_in_state", school)} />
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Counted by where applicants lived when they applied, which can differ from who qualifies for in-state tuition. A group&apos;s rate reflects who
        applies from there as well as how the college chooses.
      </p>
    </div>
  );
}
