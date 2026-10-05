import type { School } from "@/lib/types";
import type { Dataset } from "@/lib/data";
import { TABLE_GROUPS, type CompareRow } from "@/lib/compare-topics";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * "Admission: <factor>" rows from the admissions TABLE_GROUPS group (lib/compare-topics.ts FACTOR_ROWS): the
 * federal survey's use (Required/Considered/Not considered), or the college's own Common Data Set C7 level when it
 * has one, exactly as the "All the numbers" table shows it. Excludes the CDS-only C7 factors (the extra rows
 * ADMISSION_PROFILE_ROWS adds, term "factor-importance"): those never carry a federal use and stay in the full
 * table only.
 */
const FACTOR_LABEL = /^Admission: (.+)$/;
const FACTOR_ROWS: readonly CompareRow[] = TABLE_GROUPS.find((g) => g.topic === "admissions")!.rows.filter(
  ([label, term]) => FACTOR_LABEL.test(label) && term !== "factor-importance"
);

/** Whether any compared college has a value for at least one admission factor (the page's empty-state check). */
export function anyAdmissionFactorReported(schools: readonly School[]): boolean {
  return FACTOR_ROWS.some(([, , , fmt]) => schools.some((s) => fmt(s) !== null));
}

/**
 * "What they look at" (specs/compare-redesign.md#topic-pages): the admissions factors as a small card instead of
 * table rows, one row per factor and one column per college in its slot color. The box scrolls sideways on its
 * own; the factor column sticks on the left so it stays readable while scrolling. Each label carries its glossary
 * term and the row's citation; a missing value shows "–", never 0.
 */
export function AdmissionFactorsGrid({ schools, citeField }: { schools: School[]; citeField: Dataset["citeField"] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card lg:overflow-clip">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="border-b bg-surface-2">
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground sm:px-4">Factor</th>
            {schools.map((s, i) => (
              <th key={s.unit_id} className="bg-surface-2 px-4 py-2.5 text-left text-xs font-bold">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                  {shortName(s)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {FACTOR_ROWS.map(([label, term, field, fmt]) => (
            <tr key={label}>
              <td className="sticky left-0 z-10 max-w-32 bg-card px-3 py-2 text-muted-foreground shadow-[1px_0_0_var(--border)] sm:max-w-none sm:px-4 sm:shadow-none">
                <span className="inline-flex items-center gap-1">
                  {label.replace(FACTOR_LABEL, "$1")} <InfoTip term={term} cited={citeField(field)} />
                </span>
              </td>
              {schools.map((s) => {
                const value = fmt(s);
                return (
                  <td key={s.unit_id} className="px-4 py-2 font-semibold">
                    {value ?? <span className="font-normal text-muted-foreground">–</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
