import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { REQUIREMENT_LABELS, REQUIREMENT_WEIGHT, transferCard } from "@/lib/cds/transfer-display";
import { pctSmart } from "@/lib/format";
import { BLOCK_SCROLL } from "@/components/profile/Panel";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
import { RequirementChecklist } from "@/components/school/RequirementChecklist";
import { cn } from "@/lib/utils";

/**
 * "Transferring in" (specs/data-expansion/cds-transfer.md) on the Admissions page: the transfer acceptance rate beside
 * the first-year rate (each cited on its own, so their years can differ), the terms transfers may start, minimum credits
 * and GPA when stated, application dates, and what the application needs, all from the college's Common Data Set
 * section D. Renders nothing unless the college says whether it enrolls transfers or its transfer rate is known.
 */
export function TransferringInCard({
  school,
  cite,
  color,
  id,
  className,
}: {
  school: School;
  /** citeField bound to the dataset (server only). */
  cite: (path: FieldPath, school?: School) => Cited;
  color: string;
  id?: string;
  className?: string;
}) {
  const m = transferCard(school);
  if (!m) return null;
  const headline = cite(m.rate !== null ? "reported.transfer.admit_rate" : "reported.transfer.enrolls_transfers", school);
  const line = "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm";

  return (
    <div id={id} className={cn("rounded-3xl border bg-card p-4 sm:p-6", BLOCK_SCROLL, className)}>
      <h3 className="mb-3 flex items-center gap-1 font-display text-lg font-bold">
        Transferring in <InfoTip term="transfer-admission" cited={headline} />
      </h3>
      {m.enrolls === false ? (
        <p className={cn(line, "text-muted-foreground")}>
          <MetricLabel cited={cite("reported.transfer.enrolls_transfers", school)}>Does not enroll transfer students</MetricLabel>
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-3">
            {m.rate !== null && (
              <div className="space-y-2">
                <p className={line}>
                  <MetricLabel cited={cite("reported.transfer.admit_rate", school)}>
                    <span className="font-display text-2xl font-extrabold tabular-nums" style={{ color }}>
                      {pctSmart(m.rate)}
                    </span>{" "}
                    of transfer applicants were admitted
                  </MetricLabel>
                  {m.firstYearRate !== null && (
                    <MetricLabel cited={cite("admissions.acceptance_rate", school)} className="text-muted-foreground">
                      vs. {pctSmart(m.firstYearRate)} of first-year applicants
                    </MetricLabel>
                  )}
                </p>
                {m.t.applicants && m.t.admitted && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    <MetricLabel cited={cite("reported.transfer.applicants", school)}>{m.t.applicants.total.toLocaleString("en-US")} applied</MetricLabel>
                    {" · "}
                    <MetricLabel cited={cite("reported.transfer.admitted", school)}>{m.t.admitted.total.toLocaleString("en-US")} admitted</MetricLabel>
                    {m.t.enrolled && (
                      <>
                        {" · "}
                        <MetricLabel cited={cite("reported.transfer.enrolled", school)}>{m.t.enrolled.total.toLocaleString("en-US")} enrolled</MetricLabel>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            {m.termsSentence && (
              <p className={line}>
                <MetricLabel cited={cite("reported.transfer.terms", school)}>{m.termsSentence}</MetricLabel>
              </p>
            )}
            {m.creditsSentence && (
              <p className={line}>
                <MetricLabel cited={cite("reported.transfer.min_credits", school)}>{m.creditsSentence}</MetricLabel>
              </p>
            )}
            {m.gpa.college !== null && (
              <p className={line}>
                <MetricLabel cited={cite("reported.transfer.min_college_gpa", school)}>Minimum college GPA: {m.gpa.college.toFixed(1)}</MetricLabel>
              </p>
            )}
            {m.gpa.hs !== null && (
              <p className={line}>
                <MetricLabel cited={cite("reported.transfer.min_hs_gpa", school)}>Minimum high school GPA: {m.gpa.hs.toFixed(1)}</MetricLabel>
              </p>
            )}
            {m.t.advanced_standing === true && (
              <p className={cn(line, "text-muted-foreground")}>
                <MetricLabel term="advanced-standing" cited={cite("reported.transfer.advanced_standing", school)}>
                  Grants credit for course work completed at another college
                </MetricLabel>
              </p>
            )}
            {m.dates.length > 0 && (
              <div className="space-y-1">
                <p className={cn(line, "font-medium")}>
                  <MetricLabel cited={cite("reported.transfer.dates", school)}>Dates</MetricLabel>
                </p>
                <ul className="space-y-0.5 text-sm text-muted-foreground">
                  {m.dates.map((d) => (
                    <li key={d.term}>{d.sentence}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {m.materials.length > 0 && (
            <div>
              <p className={cn(line, "mb-2 font-medium")}>
                <MetricLabel cited={cite("reported.transfer.required_materials", school)}>What the application needs</MetricLabel>
              </p>
              <RequirementChecklist
                rows={m.materials.map((r) => ({ key: r.key, label: r.label, level: REQUIREMENT_LABELS[r.level], weight: REQUIREMENT_WEIGHT[r.level] }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
