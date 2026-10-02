import type { Dataset } from "@/lib/data";
import type { School } from "@/lib/types";
import { yearLabel } from "@/lib/lineage";
import { num, pctSmart } from "@/lib/format";
import { MetricLabel } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * The newest admissions figures a college has published itself (specs/college-reported-data.md#display): the
 * college's headline number with the federal figure underneath as the baseline, and counts when published. Every
 * value is cited with `citeField("reported.admissions.…", school)`, which carries the quote, link, retrieved date
 * and method into the ⓘ popover. `citeField` comes from the caller's `getData()` so this stays a plain component.
 */
export function ReportedAdmissionsBlock({ school, citeField, className }: { school: School; citeField: Dataset["citeField"]; className?: string }) {
  const r = school.reported?.admissions;
  if (!r) return null;
  const rateCited = r.acceptance_rate != null ? citeField("reported.admissions.acceptance_rate", school) : null;
  const applicantsCited = r.applicants != null ? citeField("reported.admissions.applicants", school) : null;
  const headlineCited = rateCited ?? applicantsCited;
  if (!headlineCited) return null;
  const term = yearLabel(headlineCited);
  const federalRate = school.admissions.acceptance_rate;
  const federalCited = citeField("admissions.acceptance_rate", school);

  // Each count is cited by name (not built from a shared path) so every displayed value's citation is checked
  // directly (tests/reported-guards.test.mts).
  const counts = [
    r.applicants != null && { label: "Applicants", value: r.applicants, cited: citeField("reported.admissions.applicants", school) },
    r.admitted != null && { label: "Admitted", value: r.admitted, cited: citeField("reported.admissions.admitted", school) },
    r.enrolled != null && { label: "Enrolled", value: r.enrolled, cited: citeField("reported.admissions.enrolled", school) },
  ].filter((c): c is { label: string; value: number; cited: ReturnType<Dataset["citeField"]> } => !!c);

  return (
    <div className={cn("rounded-3xl border border-pop/50 bg-pop/10 p-4 sm:p-6", className)}>
      {rateCited ? (
        <MetricLabel cited={rateCited} chip={false} className="flex-wrap font-display text-xl font-extrabold tracking-tight sm:text-2xl">
          Admit rate, {term}: {pctSmart(r.acceptance_rate!)} <span className="font-sans text-sm font-semibold text-muted-foreground">· reported by the college</span>
        </MetricLabel>
      ) : (
        <MetricLabel cited={headlineCited} chip={false} className="flex-wrap font-display text-lg font-extrabold tracking-tight">
          {term} figures, reported by the college
        </MetricLabel>
      )}
      {federalRate !== null && (
        <MetricLabel cited={federalCited} chip={false} className="mt-1 text-sm text-muted-foreground">
          Federal data, {yearLabel(federalCited)}: {pctSmart(federalRate)}
        </MetricLabel>
      )}
      {counts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {counts.map((c) => (
            <MetricLabel key={c.label} cited={c.cited} chip={false} className="text-sm">
              {c.label} <span className="font-semibold tabular-nums text-foreground">{num(c.value)}</span>
            </MetricLabel>
          ))}
        </div>
      )}
    </div>
  );
}

/** A compact one-line version for the overview card: the federal rate stays the headline figure. */
export function ReportedRateLine({ school, citeField }: { school: School; citeField: Dataset["citeField"] }) {
  const r = school.reported?.admissions;
  if (!r || r.acceptance_rate == null) return null;
  const cited = citeField("reported.admissions.acceptance_rate", school);
  return (
    <MetricLabel cited={cited} chip={false} className="mt-2 text-xs font-semibold text-muted-foreground">
      Newer: {pctSmart(r.acceptance_rate)} admitted for {yearLabel(cited)}, reported by the college
    </MetricLabel>
  );
}
