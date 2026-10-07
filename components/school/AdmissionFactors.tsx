import { getData } from "@/lib/data";
import type { AdmissionFactor, FactorUse, School } from "@/lib/types";
import type { FieldPath } from "@/lib/fields";
import { C7_FACTORS, IMPORTANCE_LABELS, IMPORTANCE_LEVELS, admissionProfile } from "@/lib/cds/admissions";
import { DOMAINS } from "@/lib/metrics";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
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

/** IPEDS factors C7 doesn't ask about: one line under the four-level grid when any is used. */
const FEDERAL_ONLY: readonly AdmissionFactor[] = ["hs_record", "college_prep", "competencies", "english_test", "other_test"];
const FEDERAL_ONLY_WORDS: Partial<Record<AdmissionFactor, string>> = {
  hs_record: "high school record",
  college_prep: "college-prep program",
  competencies: "demonstration of competencies",
  english_test: "English proficiency test",
  other_test: "other tests",
};

const fallOf = (year: string | null | undefined) => Number(/^Fall (\d{4})$/.exec(year ?? "")?.[1]) || null;

/**
 * "What they look at" (specs/data-expansion/admission-factors.md, cds-admissions.md Display 3): the college's own
 * four-level C7 grid when its CDS class is at least as new as the federal survey's, else each factor's use as
 * reported to IPEDS.
 */
export async function AdmissionFactors({ school }: { school: School }) {
  const { citeField } = await getData();
  const f = school.admissions.factors;
  const c7 = admissionProfile(school)?.factors;
  const c7Cite = (k: string) => citeField(`reported.admission_profile.factors.${k}` as FieldPath, school);
  const c7Year = c7 ? fallOf(c7Cite(Object.keys(c7)[0]).year) : null;
  const fedYear = fallOf(citeField("admissions.factors").year);
  if (c7 && c7Year !== null && (fedYear === null || c7Year >= fedYear)) return <FourLevelGrid school={school} />;
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

/** The C7 grid: Academic and Personal rows, one filled mark per row; on phones, the level as a word. */
async function FourLevelGrid({ school }: { school: School }) {
  const { citeField } = await getData();
  const c7 = admissionProfile(school)!.factors!;
  const f = school.admissions.factors;
  const color = DOMAINS.admissions.color;
  const cite = (k: string) => citeField(`reported.admission_profile.factors.${k}` as FieldPath, school);
  const first = C7_FACTORS.find((r) => c7[r.key])!;
  const federalOnly = FEDERAL_ONLY.filter((k) => f?.[k] && f[k] !== "not_considered").map((k) => `${FEDERAL_ONLY_WORDS[k]} ${f![k] === "required" ? "required" : "considered"}`);
  const legacy = c7.alumni_relation;

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-1 flex items-center gap-1.5 font-display text-lg font-bold">
        What they look at <InfoTip term="factor-importance" cited={cite(first.key)} />
      </h3>
      {legacy && legacy !== "not_considered" && (
        <p className="text-sm text-muted-foreground">
          <MetricLabel term="legacy-status" cited={cite("alumni_relation")}>
            Considers whether an applicant&apos;s parent attended (legacy status).
          </MetricLabel>
        </p>
      )}
      <table className="mt-4 w-full text-sm">
        <thead className="max-sm:hidden">
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 text-left font-semibold" />
            {IMPORTANCE_LEVELS.map((l) => (
              <th key={l} className="w-24 py-1 text-center font-semibold">
                {IMPORTANCE_LABELS[l]}
              </th>
            ))}
          </tr>
        </thead>
        {(["academic", "personal"] as const).map((group) => (
          <tbody key={group} className="divide-y divide-dashed">
            <tr>
              <th colSpan={5} className="pt-3 pb-1 text-left text-xs font-bold tracking-[0.12em] text-foreground/70 uppercase">
                {group === "academic" ? "Academic" : "Personal"}
              </th>
            </tr>
            {C7_FACTORS.filter((r) => r.group === group && c7[r.key]).map((r) => {
              const level = c7[r.key]!;
              return (
                <tr key={r.key}>
                  <td className="py-1.5">
                    <MetricLabel term={r.term} cited={cite(r.key)}>{r.label}</MetricLabel>
                  </td>
                  <td className="py-1.5 text-right text-xs font-semibold sm:hidden">{IMPORTANCE_LABELS[level]}</td>
                  {IMPORTANCE_LEVELS.map((l) => (
                    <td key={l} className="py-1.5 text-center max-sm:hidden">
                      {l === level ? (
                        <span className="inline-block size-3 rounded-full" style={{ backgroundColor: color }} aria-label={IMPORTANCE_LABELS[l]} role="img" />
                      ) : (
                        <span className="inline-block size-1.5 rounded-full bg-border" aria-hidden />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {federalOnly.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <MetricLabel term="admission-factor" cited={citeField("admissions.factors", school)}>
            From the federal survey: {federalOnly.join("; ")}
          </MetricLabel>
        </p>
      )}
    </div>
  );
}
