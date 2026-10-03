import { getData } from "@/lib/data";
import type { AdmissionFactor, FactorUse, School } from "@/lib/types";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/** Grid order: what families ask about first. Test scores are shown with the scores (`test_policy`). */
const ORDER: readonly { key: AdmissionFactor; label: string; term?: "secondary-school-record" | "college-prep-program" | "legacy-status" }[] = [
  { key: "gpa", label: "High school GPA" },
  { key: "hs_record", label: "High school record", term: "secondary-school-record" },
  { key: "class_rank", label: "Class rank" },
  { key: "college_prep", label: "College-prep program", term: "college-prep-program" },
  { key: "recommendations", label: "Recommendations" },
  { key: "essay", label: "Essay" },
  { key: "legacy", label: "Legacy status", term: "legacy-status" },
  { key: "work_experience", label: "Work experience" },
  { key: "competencies", label: "Demonstration of competencies" },
  { key: "english_test", label: "English proficiency test" },
  { key: "other_test", label: "Other tests" },
];

const USE: Record<FactorUse, { label: string; className: string }> = {
  required: { label: "Required", className: "bg-foreground text-background" },
  considered: { label: "Considered", className: "border bg-card" },
  not_considered: { label: "Not considered", className: "text-muted-foreground" },
};

/** "What they look at" (specs/data-expansion/admission-factors.md): each factor's use, as reported to IPEDS. */
export async function AdmissionFactors({ school }: { school: School }) {
  const { citeField } = await getData();
  const f = school.admissions.factors;
  if (!f) return null;
  const cited = citeField("admissions.factors", school);
  const rows = ORDER.filter((o) => f[o.key]);

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-1 flex items-center gap-1.5 font-display text-lg font-bold">
        What they look at <InfoTip term="admission-factor" cited={cited} />      </h3>
      {(f.legacy === "considered" || f.legacy === "required") && (
        <p className="text-sm text-muted-foreground">Considers whether an applicant&apos;s parent attended (legacy status).</p>
      )}
      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((o) => {
          const use = USE[f[o.key]!];
          return (
            <div key={o.key} className="flex items-center justify-between gap-3 border-b border-dashed py-1.5 text-sm last:border-0">
              <dt className="flex items-center gap-1">
                {o.label}
                {o.term && <InfoTip term={o.term} />}
              </dt>
              <dd className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", use.className)}>{use.label}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
