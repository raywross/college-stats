import type { Dataset } from "@/lib/data";
import type { School } from "@/lib/types";
import type { PartialAdmissions } from "@/lib/newest";
import { yearLabel } from "@/lib/lineage";
import { num, pctSmart } from "@/lib/format";
import { MetricLabel } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * Under a college-reported headline (specs/college-reported-round-2.md, Decision 1): the federal figure stays one
 * line away, so the baseline used in comparisons is still visible next to the fresher number. Rendered only when the
 * admissions page/card is showing the college's own figures as the headline (`newest.source === "reported"`).
 */
export function FederalBaselineLine({ school, citeField, className }: { school: School; citeField: Dataset["citeField"]; className?: string }) {
  const federalRate = school.admissions.acceptance_rate;
  if (federalRate === null) return null;
  const cited = citeField("admissions.acceptance_rate", school);
  return (
    <MetricLabel cited={cited} chip={false} className={cn("text-xs font-semibold text-muted-foreground", className)}>
      Federal data, {yearLabel(cited)}: {pctSmart(federalRate)}
    </MetricLabel>
  );
}

/**
 * A newer figure the college published that isn't enough for a full funnel (e.g. applicants only), shown as a line
 * under the federal funnel rather than replacing it. Each present value is cited by name (not a shared path
 * variable), so tests/reported-guards.test.mts can check every displayed path is cited.
 */
export function PartialReportedLine({ school, citeField, partial, className }: { school: School; citeField: Dataset["citeField"]; partial: PartialAdmissions; className?: string }) {
  const parts: { label: string; value: string; cited: ReturnType<Dataset["citeField"]> }[] = [];
  if (partial.applicants != null) parts.push({ label: "applied", value: num(partial.applicants), cited: citeField("reported.admissions.applicants", school) });
  if (partial.admitted != null) parts.push({ label: "admitted", value: num(partial.admitted), cited: citeField("reported.admissions.admitted", school) });
  if (partial.enrolled != null) parts.push({ label: "enrolled", value: num(partial.enrolled), cited: citeField("reported.admissions.enrolled", school) });
  if (partial.acceptance_rate != null) parts.push({ label: "admit rate", value: pctSmart(partial.acceptance_rate), cited: citeField("reported.admissions.acceptance_rate", school) });
  if (parts.length === 0) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground", className)}>
      <span className="font-semibold text-foreground">{partial.term}:</span>{" "}
      {parts.map((p, i) => (
        <span key={p.label}>
          <MetricLabel cited={p.cited} chip={false} className="inline">
            {p.value} {p.label}
          </MetricLabel>
          {i < parts.length - 1 ? " · " : ""}
        </span>
      ))}{" "}
      <span>· reported by the college</span>
    </p>
  );
}
