import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowRight, MapPin } from "lucide-react";
import { getHighSchool } from "@/lib/high-schools";
import { gradeSpan } from "@/lib/high-school-core";
import { citeHsView, hsValueAt, isHsSuppressed, type HsFieldPath } from "@/lib/hs-fields";
import type { HsStateField } from "@/lib/high-school-types";
import { gradRateText, hsStateName, hsValueText, matriculationSummaryLine, shareText } from "@/lib/high-school-ui";
import { num, pctSmart } from "@/lib/format";
import { HsBadges } from "@/components/high-schools/HsBadges";
import { HsStat } from "@/components/high-schools/HsStat";
import { HsSourceLine } from "@/components/high-schools/HsSourceLine";
import { InfoTip, Term } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const view = await getHighSchool(id);
  return { title: view ? view.school.name : "High school not found" };
}

export const revalidate = 86400;

function Section({ id, title, children, note }: { id: string; title: string; children?: ReactNode; note?: string }) {
  if (!children && !note) return null;
  return (
    <section id={id} className="scroll-mt-28 border-t pt-8 first:border-t-0 first:pt-0">
      <h2 className="font-display text-2xl font-extrabold tracking-tight">{title}</h2>
      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

const medianOf = (medians: Record<string, number | null | undefined> | null, key: string, format: (n: number) => string): string | null => {
  const v = medians?.[key];
  return typeof v === "number" ? format(v) : null;
};

/**
 * `/high-schools/{id}` (specs/product/high-school-data.md "Display"): header, Rigor, Outcomes, Grading, Where
 * graduates go, each value against the state median where one exists; sections with nothing say so in one line
 * rather than showing an empty block (same rule college topic pages follow for missing data).
 */
export default async function HighSchoolPage({ params }: Props) {
  const { id } = await params;
  const view = await getHighSchool(id);
  if (!view) notFound();
  const { school, state_report, detail, medians, meta } = view;
  const extras = { stateReport: state_report, detail };
  const cite = (path: HsFieldPath) => citeHsView(path, view);
  // hsValueAt reads `undefined` for a leaf under a null parent (a private school's whole `rigor` block); treated the
  // same as `null` here (no value), so "not reported" sections render correctly for schools with nothing at all.
  const value = (path: HsFieldPath): number | null => {
    const v = hsValueAt(path, school, extras);
    return typeof v === "number" ? v : null;
  };
  const suppressed = (path: HsFieldPath) => isHsSuppressed(path, school, extras);
  const median = (key: string, format: (n: number) => string) => medianOf(medians, key, format);
  const isPublic = school.kind === "public";
  const stateName = hsStateName(school.state);

  const stateVal = (f: HsStateField): number | null => (state_report?.values[f] ?? null);
  const stateSuppressed = (f: HsStateField) => !!state_report?.suppressed.includes(f);

  const rigorFields: HsFieldPath[] = ["rigor.ap_courses", "derived.ap_enrolled_share", "derived.ap_pass_share", "derived.ib_enrolled_share", "derived.dual_enrolled_share"];
  const hasRigor = rigorFields.some((p) => value(p) !== null || suppressed(p));
  const hasOutcomes = school.grad_rate !== null || (["college_going_rate", "ela_proficiency", "math_proficiency", "chronic_absence"] as HsStateField[]).some((f) => stateVal(f) !== null || stateSuppressed(f));
  const hasWhereGo = !!detail?.matriculation || (["nsc_enrolled_fall", "nsc_persisted", "nsc_completed"] as HsStateField[]).some((f) => stateVal(f) !== null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      {/* ============================== HEADER ============================== */}
      <header>
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
          <Link href="/high-schools" className="hover:text-foreground">
            High schools
          </Link>
        </nav>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{school.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" />
            {school.city ? `${school.city}, ${school.state}` : stateName}
          </span>
          {school.district && <span>{school.district.name}</span>}
          <span>{isPublic ? "Public" : "Private"}{school.affiliation ? ` · ${school.affiliation}` : ""}</span>
          <span>Grades {gradeSpan(school.grades)}</span>
          {school.locale && <Term term="locale">{school.locale}</Term>}
        </div>
        <HsBadges status={school.status} className="mt-3 flex flex-wrap gap-1.5" />
      </header>

      {/* ============================== ENROLLMENT ============================== */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <HsStat
          label="Enrollment"
          cited={cite("enrollment.total")}
          value={hsValueText(value("enrollment.total") as number | null, suppressed("enrollment.total"), num, "count")}
          median={median("enrollment.total", num)}
        />
        <HsStat
          label="Student-to-teacher ratio"
          term="student-teacher-ratio"
          cited={cite("student_teacher_ratio")}
          value={hsValueText(value("student_teacher_ratio") as number | null, suppressed("student_teacher_ratio"), (n) => `${n.toFixed(1)}:1`)}
          median={median("student_teacher_ratio", (n) => `${n.toFixed(1)}:1`)}
        />
        <HsStat
          label="Free or reduced-price lunch"
          term="free-reduced-lunch"
          cited={cite("frl_share")}
          value={shareText(value("frl_share") as number | null, suppressed("frl_share"))}
          median={median("frl_share", pctSmart)}
        />
      </div>

      {/* ============================== RIGOR ============================== */}
      <Section id="rigor" title="Rigor" note={!isPublic && !hasRigor ? "Private schools don't report AP/IB access through the federal Civil Rights Data Collection." : !hasRigor ? "Not yet reported for this school." : undefined}>
        {hasRigor && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <HsStat
              label="AP courses offered"
              term="ap-access"
              cited={cite("rigor.ap_courses")}
              value={hsValueText(value("rigor.ap_courses") as number | null, suppressed("rigor.ap_courses"), num, "count")}
              median={median("rigor.ap_courses", num)}
            />
            <HsStat
              label="Students in an AP course"
              term="ap-access"
              cited={cite("derived.ap_enrolled_share")}
              value={shareText(value("derived.ap_enrolled_share") as number | null, suppressed("derived.ap_enrolled_share"))}
              median={median("derived.ap_enrolled_share", pctSmart)}
            />
            {/* The CRDC stopped collecting AP exam results after 2017–18: shown only when a school has the figure. */}
            {(value("derived.ap_pass_share") !== null || suppressed("derived.ap_pass_share")) && (
              <HsStat
                label="AP exam takers who passed one"
                term="ap-access"
                cited={cite("derived.ap_pass_share")}
                value={shareText(value("derived.ap_pass_share") as number | null, suppressed("derived.ap_pass_share"))}
                median={median("derived.ap_pass_share", pctSmart)}
              />
            )}
            <HsStat
              label="Students in the IB Diploma Programme"
              term="ib-program"
              cited={cite("derived.ib_enrolled_share")}
              value={shareText(value("derived.ib_enrolled_share") as number | null, suppressed("derived.ib_enrolled_share"))}
              median={median("derived.ib_enrolled_share", pctSmart)}
            />
            <HsStat
              label="Students in dual enrollment"
              term="dual-enrollment"
              cited={cite("derived.dual_enrolled_share")}
              value={shareText(value("derived.dual_enrolled_share") as number | null, suppressed("derived.dual_enrolled_share"))}
              median={median("derived.dual_enrolled_share", pctSmart)}
            />
            {stateVal("ap_pass_rate") !== null && (
              <HsStat
                label="AP pass rate (state report)"
                term="ap-access"
                cited={cite("state.ap_pass_rate")}
                value={pctSmart(stateVal("ap_pass_rate")!)}
                median={median("state.ap_pass_rate", pctSmart)}
              />
            )}
          </div>
        )}
      </Section>

      {/* ============================== OUTCOMES ============================== */}
      <Section id="outcomes" title="Outcomes" note={!hasOutcomes ? "Not yet reported for this school." : undefined}>
        {hasOutcomes && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(school.grad_rate !== null || isPublic) && (
              <HsStat
                label="Four-year graduation rate"
                term="adjusted-cohort-graduation-rate"
                cited={cite("grad_rate")}
                value={gradRateText(school.grad_rate, suppressed("grad_rate"))}
                median={median("grad_rate", pctSmart)}
              />
            )}
            {(stateVal("college_going_rate") !== null || stateSuppressed("college_going_rate")) && (
              <HsStat
                label="College-going rate"
                term="college-going-rate"
                cited={cite("state.college_going_rate")}
                value={hsValueText(stateVal("college_going_rate"), stateSuppressed("college_going_rate"), pctSmart)}
                median={median("state.college_going_rate", pctSmart)}
              />
            )}
            {(stateVal("ela_proficiency") !== null || stateSuppressed("ela_proficiency")) && (
              <HsStat
                label="Reading/ELA proficiency"
                term="state-proficiency"
                cited={cite("state.ela_proficiency")}
                value={hsValueText(stateVal("ela_proficiency"), stateSuppressed("ela_proficiency"), pctSmart)}
                median={median("state.ela_proficiency", pctSmart)}
              />
            )}
            {(stateVal("math_proficiency") !== null || stateSuppressed("math_proficiency")) && (
              <HsStat
                label="Math proficiency"
                term="state-proficiency"
                cited={cite("state.math_proficiency")}
                value={hsValueText(stateVal("math_proficiency"), stateSuppressed("math_proficiency"), pctSmart)}
                median={median("state.math_proficiency", pctSmart)}
              />
            )}
            {(stateVal("chronic_absence") !== null || stateSuppressed("chronic_absence")) && (
              <HsStat
                label="Chronic absence"
                term="chronic-absence"
                cited={cite("state.chronic_absence")}
                value={hsValueText(stateVal("chronic_absence"), stateSuppressed("chronic_absence"), pctSmart)}
                median={median("state.chronic_absence", pctSmart)}
              />
            )}
          </div>
        )}
      </Section>

      {/* ============================== GRADING ============================== */}
      <Section id="grading" title="Grading" note={!detail?.gpa_scale ? "No school profile on file yet." : undefined}>
        {detail?.gpa_scale && (
          <div className="space-y-4">
            <div className="rounded-2xl border bg-card p-4">
              <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <Term term="weighted-gpa">GPA scale</Term>
                <InfoTip term="weighted-gpa" cited={cite("detail.gpa_scale")} />
              </p>
              <p className="mt-1 font-display text-lg font-bold">
                {detail.gpa_scale.weighted ? "Weighted" : "Unweighted"} {detail.gpa_scale.max ? `(${detail.gpa_scale.max}.0 scale)` : ""}
              </p>
              {detail.gpa_scale.conversion && <p className="mt-1 text-sm text-muted-foreground">{detail.gpa_scale.conversion}</p>}
            </div>
            {detail.gpa_distribution && (
              <div className="rounded-2xl border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground">GPA distribution</p>
                <div className="mt-3 space-y-2">
                  {detail.gpa_distribution.map((b) => (
                    <div key={b.band} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-sm">
                      <span className="truncate text-muted-foreground">{b.band}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(b.share * 100)}%` }} />
                      </span>
                      <span className="text-right font-semibold tabular-nums">{pctSmart(b.share)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ============================== WHERE GRADUATES GO ============================== */}
      <Section id="where-go" title="Where graduates go" note={!hasWhereGo ? "Not yet reported for this school." : undefined}>
        {hasWhereGo && (
          <div className="space-y-4">
            {detail?.matriculation && (
              <div className="overflow-hidden rounded-2xl border bg-card">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {detail.matriculation.entries.map((e) => (
                      <tr key={e.name}>
                        <td className="px-4 py-2.5">
                          {e.unit_id ? (
                            <Link href={`/schools/${e.unit_id}`} className="font-semibold text-primary hover:underline">
                              {e.name}
                            </Link>
                          ) : (
                            e.name
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{e.count === null ? "Fewer than 5" : num(e.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">{matriculationSummaryLine(detail)}</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {(["nsc_enrolled_fall", "nsc_persisted", "nsc_completed"] as const).map((f) => {
                const v = stateVal(f);
                if (v === null && !stateSuppressed(f)) return null;
                const labels: Record<typeof f, { label: string; term: TermKey }> = {
                  nsc_enrolled_fall: { label: "Enrolled the fall after graduating", term: "college-going-rate" },
                  nsc_persisted: { label: "Returned for year two", term: "clearinghouse-persistence" },
                  nsc_completed: { label: "Completed a degree", term: "clearinghouse-completion" },
                } as const;
                return (
                  <HsStat
                    key={f}
                    label={labels[f].label}
                    term={labels[f].term}
                    cited={cite(`state.${f}`)}
                    value={hsValueText(v, stateSuppressed(f), pctSmart)}
                    median={median(`state.${f}`, pctSmart)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* ============================== SOURCES ============================== */}
      <div className="mt-10 border-t pt-6">
        <HsSourceLine
          paths={[
            "enrollment.total",
            "student_teacher_ratio",
            "frl_share",
            "grad_rate",
            "rigor.ap_courses",
            "derived.ap_enrolled_share",
            "derived.ap_pass_share",
            "derived.ib_enrolled_share",
            "derived.dual_enrolled_share",
            "state.college_going_rate",
            "state.ap_pass_rate",
            "state.ela_proficiency",
            "state.math_proficiency",
            "state.chronic_absence",
            "state.nsc_enrolled_fall",
            "state.nsc_persisted",
            "state.nsc_completed",
            "detail.gpa_scale",
            "detail.gpa_distribution",
            "detail.matriculation",
          ]}
          view={view}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          NCES school ID <span className="font-mono">{school.id}</span> · Data generated {meta.generated}.{" "}
          <Link href="/data#high-schools" className="font-medium hover:text-primary hover:underline">
            About high school data <ArrowRight className="inline size-3" />
          </Link>
        </p>
      </div>
    </div>
  );
}
