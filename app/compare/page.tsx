import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Swords } from "lucide-react";
import { getData, getDetail, getHistoryFiles, toIndexEntry } from "@/lib/data";
import { isPlausibleCip4, programsWithEarnings } from "@/lib/field-of-study";
import { firstMajorsByGroup } from "@/lib/majors";
import { cip4Title } from "@/lib/cip";
import { MajorPicker, YourMajorBars, type MajorRow } from "@/components/compare/YourMajor";
import { RACE_SERIES, SERIES, defaultWindow, historyYearLabel } from "@/lib/history";
import { INDICATORS, INDICATOR_KEYS, indicatorsOf } from "@/lib/indicators";
import { TrendIndicatorCell } from "@/components/trends/TrendIndicators";
import type { TrendKey } from "@/lib/types";
import { ThenAndNow, type ThenAndNowMetric } from "@/components/compare/ThenAndNow";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import type { FieldPath } from "@/lib/fields";
import type { TermKey } from "@/lib/glossary";
import { DEMOGRAPHIC_CATEGORIES, DOMAINS, METRICS, TEST_POLICY_LABELS, admitRatesBySex, satComposite, type Domain } from "@/lib/metrics";
import { RADAR_AXES, keyDifferences, radarProfile, similarSchools } from "@/lib/insights";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { DESIGNATION_LABELS, RESEARCH_LABELS } from "@/lib/campus-profile";
import { CALENDAR_LABELS, DIVISION_LABELS, ROTC_LABELS, divisionFilterOf } from "@/lib/campus-services";
import { FORM_SHORT } from "@/lib/finances";
import { compact, money, moneyCompact, num, pct, pctSmart } from "@/lib/format";
import { gradRateCell } from "@/lib/graduation-groups";
import type { School } from "@/lib/types";
import { CompareHeader } from "@/components/compare/CompareHeader";
import { CompareMetric } from "@/components/compare/CompareMetric";
import { NetPriceCompare } from "@/components/compare/NetPriceCompare";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { Crest } from "@/components/school/Crest";
import { RadarChart } from "@/components/charts/RadarChart";
import { RangeBar } from "@/components/charts/RangeBar";
import { StackedBar } from "@/components/charts/StackedBar";
import { InfoTip, SourceChip, Term } from "@/components/ui/info-tip";

export const metadata: Metadata = { title: "Compare" };

const MATCHUPS = [
  ["166027", "243744"],
  ["110635", "110662"],
  ["170976", "234076", "199120"],
  ["168342", "121345"],
  ["131520", "199120"],
  ["145637", "204796", "236948"],
];

function Group({ domain, title, children }: { domain: Domain; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight sm:text-2xl">
        <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: DOMAINS[domain].color }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One "All the numbers" row per admission factor (specs/data-expansion/admission-factors.md). */
const FACTOR_USE_LABELS = { required: "Required", considered: "Considered", not_considered: "Not considered" } as const;
const FACTOR_ROWS = (
  [
    ["gpa", "High school GPA"],
    ["hs_record", "High school record"],
    ["class_rank", "Class rank"],
    ["college_prep", "College-prep program"],
    ["recommendations", "Recommendations"],
    ["essay", "Essay"],
    ["legacy", "Legacy status"],
    ["work_experience", "Work experience"],
    ["competencies", "Demonstration of competencies"],
    ["english_test", "English proficiency test"],
    ["other_test", "Other tests"],
  ] as const
).map(
  ([k, label]) =>
    [
      `Admission: ${label}`,
      k === "legacy" ? "legacy-status" : "admission-factor",
      "admissions.factors",
      (s: School) => {
        const use = s.admissions.factors?.[k];
        return use ? FACTOR_USE_LABELS[use] : null;
      },
    ] as const
) satisfies readonly (readonly [string, TermKey, FieldPath, (s: School) => string | null])[];

/**
 * "All the numbers" rows: label, glossary term, registered field (for its
 * citation and per-school source chips), and formatter.
 */
const TABLE_ROWS = (
  [
    // Sources differ by school (federal survey vs. a college's own CDS), so show which class each row describes.
    ["Admissions data", "cds", "admissions.year", (s: School) => (s.admissions.year ? `Fall ${s.admissions.year}` : null)],
    ["Acceptance rate", "acceptance-rate", "admissions.acceptance_rate", (s: School) => s.admissions.acceptance_rate === null ? null : pctSmart(s.admissions.acceptance_rate)],
    ["Acceptance rate, men / women", "admit-rate-by-sex", "admissions.by_sex", (s: School) => {
      const r = admitRatesBySex(s);
      return r.men === null || r.women === null ? null : `${pctSmart(r.men)} / ${pctSmart(r.women)}`;
    }],
    ["Applicants", "applicants", "admissions.applicants", (s: School) => opt(s.admissions.applicants, num)],
    ["Admitted", "admitted", "admissions.admitted", (s: School) => opt(s.admissions.admitted, num)],
    ["Enrolled", "enrolled", "admissions.enrolled", (s: School) => opt(s.admissions.enrolled, num)],
    ["Yield", "yield", "derived.yield", (s: School) => opt(METRICS.yield.get(s), (v) => pct(v))],
    ["SAT middle 50%", "middle-50", "derived.sat_composite", (s: School) => satComposite(s)?.join("–") ?? null],
    ["ACT middle 50%", "act", "admissions.act_composite_25_75", (s: School) => s.admissions.act_composite_25_75?.join("–") ?? null],
    ...FACTOR_ROWS,
    ["Test policy", "test-policy", "admissions.test_policy", (s: School) => (s.admissions.test_policy ? TEST_POLICY_LABELS[s.admissions.test_policy] : null)],
    ["Application fee", "application-fee", "admissions.application_fee", (s: School) =>
      s.admissions.application_fee == null ? null : s.admissions.application_fee === 0 ? "None" : money(s.admissions.application_fee)],
    ["Setting", "locale", "campus.setting", (s: School) => s.campus?.setting?.label ?? null],
    ["Carnegie class", "carnegie-classification", "campus.carnegie", (s: School) => s.campus?.carnegie?.ic ?? null],
    ["Research activity", "r1", "campus.carnegie", (s: School) =>
      !s.campus?.carnegie ? null : s.campus.carnegie.research ? RESEARCH_LABELS[s.campus.carnegie.research] : "Not a research tier"],
    ["Student access & earnings", "student-access-and-earnings", "campus.carnegie", (s: School) => s.campus?.carnegie?.access_earnings ?? null],
    ["HBCU, tribal, land-grant", "hbcu", "campus.designations", (s: School) =>
      !s.campus?.designations ? null : s.campus.designations.map((d) => DESIGNATION_LABELS[d]).join(", ") || "None"],
    ["Minority-serving, single-sex", "hsi", "campus.msi", (s: School) =>
      !s.campus?.msi ? null : s.campus.msi.map((d) => DESIGNATION_LABELS[d]).join(", ") || "None"],
    ["Athletics", "ncaa-division", "campus.athletics", (s: School) => {
      const d = divisionFilterOf(s);
      return !s.campus?.athletics ? null : d ? DIVISION_LABELS[d] : "No NCAA or NAIA division";
    }],
    ["Conference", "athletic-conference", "campus.athletics", (s: School) => {
      const a = s.campus?.athletics;
      if (!a) return null;
      if (!a.conference) return "None";
      return a.football_conference ? `${a.conference.name}; football: ${a.football_conference.name}` : a.conference.name;
    }],
    ["ROTC", "rotc", "campus.programs", (s: School) =>
      !s.campus?.programs ? null : s.campus.programs.rotc.map((b) => ROTC_LABELS[b]).join(", ") || "Not listed"],
    ["Study abroad", "study-abroad", "campus.programs", (s: School) => (!s.campus?.programs ? null : s.campus.programs.study_abroad ? "Offered" : "Not listed")],
    ["Undergraduate research program", "undergrad-research", "campus.programs", (s: School) =>
      s.campus?.programs?.undergrad_research == null ? null : s.campus.programs.undergrad_research ? "Yes" : "Not listed"],
    ["Calendar", "academic-calendar", "campus.calendar", (s: School) => (s.campus?.calendar ? CALENDAR_LABELS[s.campus.calendar] : null)],
    ["Credit for AP exams", "ap-credit", "admissions.accepts_ap_credit", (s: School) =>
      s.admissions.accepts_ap_credit == null ? null : s.admissions.accepts_ap_credit ? "Yes" : "Not listed"],
    ["Undergrads", "undergrad-enrollment", "demographics.undergrad_enrollment", (s: School) => num(s.demographics.undergrad_enrollment)],
    ["Students per faculty member", "student-faculty-ratio", "academics.student_faculty_ratio", (s: School) =>
      s.academics?.student_faculty_ratio == null ? null : `${s.academics.student_faculty_ratio} to 1`],
    ["Full-time faculty share", "full-time-faculty", "academics.faculty.full_time_share", (s: School) =>
      s.academics?.faculty?.full_time_share == null ? null : pct(s.academics.faculty.full_time_share)],
    ["Average faculty salary", "nine-month-equated-salary", "academics.faculty", (s: School) =>
      s.academics?.faculty?.avg_salary_9mo == null ? null : money(s.academics.faculty.avg_salary_9mo)],
    // Majors (specs/data-expansion/majors.md): first-major bachelor's, and the 3 largest programs by share of them.
    ["Bachelor's degrees awarded", "first-major", "academics.bachelors_awarded", (s: School) => opt(s.academics?.bachelors_awarded ?? null, num)],
    ["Most popular majors", "cip-code", "academics.majors_top", (s: School) =>
      s.academics?.majors_top?.length ? s.academics.majors_top.slice(0, 3).map((m) => `${m.title} ${pct(m.share)}`).join(" · ") : null],
    // Compared only within the same accounting form; the form is shown since figures otherwise look directly comparable.
    ["Instruction spending per student", "instruction-expenses", "finances", (s: School) =>
      s.finances?.instruction_per_student == null ? null : `${money(s.finances.instruction_per_student)} (${FORM_SHORT[s.finances.form]})`],
    ["Endowment per student", "endowment", "finances", (s: School) =>
      s.finances?.endowment_per_student == null ? null : `${money(s.finances.endowment_per_student)} (${FORM_SHORT[s.finances.form]})`],
    ["Tuition share of core revenue", "gasb-fasb", "finances", (s: School) =>
      s.finances?.tuition_share_of_revenue == null ? null : pct(s.finances.tuition_share_of_revenue)],
    ["Beds in college housing", "housing-capacity", "campus.housing", (s: School) => {
      const h = s.campus?.housing;
      return !h ? null : !h.offered ? "No housing" : h.capacity == null ? null : num(h.capacity);
    }],
    ["First-years must live on campus", "live-on-requirement", "campus.housing", (s: School) => {
      const r = s.campus?.housing?.first_years_required;
      return r == null ? null : r ? "Yes" : "No";
    }],
    ["Pell Grant", "pell-grant", "demographics.pell_grant_percent", (s: School) => opt(s.demographics.pell_grant_percent, (v) => pct(v))],
    ["First-gen", "first-gen", "demographics.first_gen_percent", (s: School) => opt(s.demographics.first_gen_percent, (v) => pct(v))],
    ["Men / women", "gender-balance", "demographics.men_share", (s: School) =>
      s.demographics.men_share == null || s.demographics.women_share == null ? null : `${pct(s.demographics.men_share)} / ${pct(s.demographics.women_share)}`],
    ["Part-time students", "part-time-student", "demographics.part_time_share", (s: School) => opt(s.demographics.part_time_share ?? null, (v) => pct(v))],
    ["Students 25 and older", "adult-students", "demographics.age_25_plus_share", (s: School) => opt(s.demographics.age_25_plus_share ?? null, (v) => pct(v))],
    ["First-years from in state", "in-state-student", "demographics.residence", (s: School) => opt(s.demographics.residence?.in_state ?? null, (v) => pct(v))],
    ["First-years from other states", "in-state-student", "demographics.residence", (s: School) => opt(s.demographics.residence?.out_of_state ?? null, (v) => pct(v))],
    ["First-years from abroad", "in-state-student", "demographics.residence", (s: School) => opt(s.demographics.residence?.international ?? null, (v) => pct(v))],
    ["New transfer students this fall", "transfer-in", "demographics.transfer_in", (s: School) => opt(s.demographics.transfer_in?.count ?? null, (v) => v.toLocaleString("en-US"))],
    ["Transfers, share of new undergraduates", "transfer-in", "demographics.transfer_in", (s: School) => opt(s.demographics.transfer_in?.share_of_new ?? null, (v) => pct(v))],
    ["Diversity index", "diversity-index", "derived.diversity_index", (s: School) => opt(METRICS.diversity.get(s), (v) => v.toFixed(2))],
    ["Average cost, all students (est.)", "average-cost", "cost.avg_paid_all", (s: School) => opt(s.cost?.avg_paid_all ?? null, money)],
    ["Aid generosity (grants ÷ full price)", "aid-generosity", "derived.aid_generosity", (s: School) => opt(METRICS.aidGenerosity.get(s), (v) => pct(v))],
    ["Net price, students with grants", "net-price", "cost.aided_net_price", (s: School) => opt(s.cost?.aided_net_price ?? null, money)],
    ["Sticker price, in-state", "in-state-tuition", "cost.sticker", (s: School) => opt(s.cost?.sticker?.in_state ?? null, money)],
    ["Sticker price, out-of-state", "in-state-tuition", "cost.sticker", (s: School) => opt(s.cost?.sticker?.out_of_state ?? null, money)],
    ["Tuition guarantee", "tuition-guarantee", "cost.tuition_plans", (s: School) =>
      s.cost?.tuition_plans == null ? null : s.cost.tuition_plans.includes("guarantee") ? "Yes" : "No"],
    ["Promise program", "promise-program", "cost.promise_program", (s: School) =>
      s.cost?.promise_program == null ? null : s.cost.promise_program ? "Yes" : "No"],
    ["Tuition & fees, in-state", "in-state-tuition", "cost.tuition_fees", (s: School) => opt(s.cost?.tuition_fees?.in_state ?? null, money)],
    ["Tuition & fees, out-of-state", "in-state-tuition", "cost.tuition_fees", (s: School) => opt(s.cost?.tuition_fees?.out_of_state ?? null, money)],
    ["First-years paying out-of-state rates", "in-state-tuition", "cost.residency", (s: School) => (s.type === "public" ? opt(s.cost?.residency?.out_of_state ?? null, (v) => pct(v)) : null)],
    ["Median earnings (10 yrs)", "median-earnings", "outcomes.median_earnings_10yr", (s: School) => opt(s.outcomes?.median_earnings_10yr ?? null, money)],
    ["Graduation rate", "graduation-rate", "outcomes.graduation_rate", (s: School) => opt(s.outcomes?.graduation_rate ?? null, (v) => pct(v))],
    // Graduation by group (specs/data-expansion/graduation-by-group.md): blank under 30 students, with the class size.
    ["Graduated in 6 years, Pell Grant recipients", "pell-graduation-gap", "outcomes.grad_rate_pell", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_pell, s.outcomes?.grad_cohorts?.pell)],
    ["Graduated in 6 years, neither Pell nor subsidized loan", "pell-graduation-gap", "outcomes.grad_rate_no_pell_no_loan", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_no_pell_no_loan, s.outcomes?.grad_cohorts?.no_pell_no_loan)],
    ["Pell graduation gap", "pell-graduation-gap", "derived.pell_grad_gap", (s: School) => opt(METRICS.pellGap.get(s), METRICS.pellGap.format)],
    ["Graduated in 6 years, White students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.white, s.outcomes?.grad_cohorts_by_race?.white)],
    ["Graduated in 6 years, Asian students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.asian, s.outcomes?.grad_cohorts_by_race?.asian)],
    ["Graduated in 6 years, Hispanic/Latino students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.hispanic, s.outcomes?.grad_cohorts_by_race?.hispanic)],
    ["Graduated in 6 years, Black students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.black, s.outcomes?.grad_cohorts_by_race?.black)],
    ["Graduated in 6 years, students of two or more races", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.two_or_more, s.outcomes?.grad_cohorts_by_race?.two_or_more)],
    ["Graduated in 6 years, international students", "graduation-rate", "outcomes.grad_rate_by_race", (s: School) =>
      gradRateCell(s.outcomes?.grad_rate_by_race?.international, s.outcomes?.grad_cohorts_by_race?.international)],
    ["Retention rate", "retention-rate", "outcomes.retention_rate", (s: School) => opt(s.outcomes?.retention_rate ?? null, (v) => pct(v))],
    ["Credential within 4 years, all students", "time-to-degree", "outcomes.eight_year", (s: School) => opt(METRICS.completion4.get(s), (v) => pct(v))],
    ["Credential within 8 years, all students", "outcome-measures", "outcomes.eight_year", (s: School) => opt(METRICS.completion8.get(s), (v) => pct(v))],
    ["Enrolled at another college, 8 years on", "transfer-out", "outcomes.eight_year", (s: School) => opt(METRICS.transferOut.get(s), (v) => pct(v))],
    ["Median debt", "median-debt", "outcomes.median_debt", (s: School) => opt(s.outcomes?.median_debt ?? null, money)],
    ["Undergrads with a federal loan", "federal-loan-rate", "outcomes.federal_loan_rate", (s: School) => opt(s.outcomes?.federal_loan_rate ?? null, (v) => pct(v))],
    ["Median debt, Pell Grant recipients", "median-debt", "outcomes.median_debt_pell", (s: School) => opt(s.outcomes?.median_debt_pell ?? null, money)],
    ["First-years with grants", "grant-aid", "aid.grant_pct", (s: School) => opt(s.aid?.grant_pct ?? null, (v) => pct(v))],
    ["Average grant", "grant-aid", "aid.grant_avg", (s: School) => opt(s.aid?.grant_avg ?? null, money)],
    ["Aid from the college", "institutional-aid", "aid.institutional_pct", (s: School) => opt(s.aid?.institutional_pct ?? null, (v) => pct(v))],
  ] as const
) satisfies readonly (readonly [string, TermKey, FieldPath, (s: School) => string | null])[];

const TABLE_FIELDS: readonly FieldPath[] = [...new Set(TABLE_ROWS.map((r) => r[2]))];

const COST_FIELDS = [
  "cost.avg_paid_all",
  "derived.aid_generosity",
  "cost.aided_net_price",
  "outcomes.median_earnings_10yr",
  "outcomes.graduation_rate",
  "outcomes.median_debt",
  "aid.grant_pct",
  "aid.grant_avg",
  "cost.net_price_by_income",
] as const satisfies readonly FieldPath[];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const data = await getData();
  const { citeField, getSchoolsByIds } = data;
  const ids = (typeof params.ids === "string" ? params.ids : "").split(",").filter(Boolean).slice(0, 4);
  const schools = getSchoolsByIds([...new Set(ids)]);

  if (schools.length === 0) return <EmptyState />;

  const diffs = keyDifferences(schools);
  const historyFiles = await getHistoryFiles();

  // "Your major" (specs/data-expansion/field-of-study.md, majors.md): every 4-digit field any compared college awards
  // bachelor's in (IPEDS completions) or reports earnings for (Scorecard Field of Study), titled from CIP 2020 so both
  // sources name a field the same way. Picked via a plain GET form so the choice stays in the URL.
  const details = await Promise.all(schools.map((s) => getDetail(s.unit_id)));
  const majorGroups = details.map((d) => (d?.tables.majors ? firstMajorsByGroup(d.tables.majors.rows) : null));
  const majorTitles = new Map<string, string>();
  majorGroups.forEach((g) => g?.forEach((_, c) => majorTitles.set(c, cip4Title(c) ?? c)));
  details.forEach((d) => programsWithEarnings(d?.tables.programs?.rows).forEach((p) => majorTitles.set(p.cip4, cip4Title(p.cip4) ?? p.title)));
  const majorOptions = [...majorTitles.entries()].map(([cip4, title]) => ({ cip4, title })).sort((a, b) => a.title.localeCompare(b.title));
  const rawMajor = typeof params.major === "string" ? params.major : "";
  const selectedMajor = isPlausibleCip4(rawMajor) && majorTitles.has(rawMajor) ? rawMajor : null;
  const majorRows: MajorRow[] = selectedMajor
    ? schools.map((s, i) => ({
        school: s,
        slot: i,
        program: details[i]?.tables.programs?.rows[selectedMajor] ?? null,
        graduates: majorGroups[i] ? (majorGroups[i]!.get(selectedMajor) ?? 0) : null,
      }))
    : [];
  // "Then & now" from school.trends (10-year changes written by sync-history); money is after inflation.
  const THEN_AND_NOW: { key: TrendKey; label: string; format: "money" | "pctSmart" | "num" | "fixed2" }[] = [
    { key: "avg_paid_all", label: "Avg total cost (after inflation)", format: "money" },
    { key: "acceptance_rate", label: "Acceptance rate", format: "pctSmart" },
    { key: "applicants", label: "Applicants", format: "num" },
    { key: "undergrads", label: "Undergrads", format: "num" },
    { key: "diversity", label: "Diversity index", format: "fixed2" },
  ];
  const thenAndNow: ThenAndNowMetric[] = historyFiles
    ? THEN_AND_NOW.map((m) => {
        // The diversity index comes from the race/ethnicity shares, a fall series.
        const kind = m.key === "diversity" ? "fall" : m.key === "pell_gap" ? "cohort" : SERIES[m.key].kind;
        const [from, to] = defaultWindow(historyFiles.meta, kind);
        const withData = schools.map((sc, i) => ({ sc, i, t: sc.trends?.[m.key] })).filter((x) => x.t);
        return {
          key: m.key,
          label: m.label,
          format: m.format,
          fromLabel: historyYearLabel(from, kind),
          toLabel: historyYearLabel(to, kind),
          rows: withData.map(({ sc, i, t }) => ({
            id: sc.unit_id,
            name: shortName(sc),
            color: SLOT_COLORS[i],
            from: t!.from,
            to: t!.to,
            ...(t!.since > from ? { lateStart: historyYearLabel(t!.since, kind) } : {}),
          })),
          missing: schools.filter((sc) => !sc.trends?.[m.key]).map(shortName),
        };
      })
    : [];

  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-3 sm:mb-6">
        <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Compare</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          {schools.length === 1 ? (
            <>Pick a <span className="highlight">rival</span></>
          ) : (
            <>
              Head-to-<span className="highlight">head</span>
            </>
          )}
        </h1>
      </header>

      <CompareHeader schools={schools.map(toIndexEntry)} />

      {schools.length === 1 ? (
        <SinglePrompt school={schools[0]} />
      ) : (
        <div className="space-y-10 pt-5 sm:space-y-14 sm:pt-8">
          {/* Key differences + radar */}
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <section className="rounded-3xl border bg-card p-4 sm:p-6">
              <h2 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Key differences</h2>
              <p className="mb-5 text-sm text-muted-foreground">The biggest gaps between these schools, largest first.</p>
              <ol className="space-y-3">
                {diffs.slice(0, 6).map((d, i) => (
                  <li key={d.metric} className="flex animate-rise gap-3" style={{ animationDelay: `${i * 60}ms` }}>
                    <span
                      className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white"
                      style={{ backgroundColor: DOMAINS[METRICS[d.metric].domain].color }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{d.headline}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full origin-left animate-grow-x rounded-full"
                            style={{ width: `${Math.max(6, d.magnitude * 100)}%`, backgroundColor: DOMAINS[METRICS[d.metric].domain].color }}
                          />
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {METRICS[d.metric].label}
                          <InfoTip term={METRICS[d.metric].term} />
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-3xl border bg-card p-4 sm:p-6">
              <h2 className="flex items-center gap-1 font-display text-xl font-extrabold tracking-tight sm:text-2xl">
                The shape of each school
              </h2>
              <p className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
                Each axis is a national rank among 4-year colleges; further out = more of it.
                <InfoTip term="percentile-rank" />
              </p>
              <RadarChart
                axes={RADAR_AXES.map((a) => a.label)}
                series={schools.map((s, i) => ({
                  id: s.unit_id,
                  label: shortName(s),
                  color: SLOT_COLORS[i],
                  values: radarProfile(data, s),
                }))}
              />
            </section>
          </div>

          {schools.some((s) => indicatorsOf(s).length > 0) && (
            <section className="space-y-4">
              <h2 className="flex items-center gap-1 font-display text-xl font-extrabold tracking-tight sm:text-2xl">
                10-year direction <InfoTip term="trend-direction" />
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Four directions over each college&apos;s last 10 years of federal data. Cost is <Term term="inflation-adjusted">after inflation</Term>.
              </p>
              <div className="overflow-x-auto rounded-3xl border bg-card">
                <table className="w-full min-w-[480px] text-sm sm:min-w-[560px]">
                  <thead className="border-b bg-surface-2">
                    <tr>
                      <th className="sticky left-0 z-10 bg-surface-2 px-3 py-3 text-left text-xs font-semibold text-muted-foreground sm:px-4">Over 10 years</th>
                      {schools.map((s, i) => (
                        <th key={s.unit_id} className="px-4 py-3 text-left text-xs font-bold">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                            {shortName(s)}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {INDICATOR_KEYS.map((k) => (
                      <tr key={k} className="border-b last:border-0">
                        <th scope="row" className="sticky left-0 z-10 w-32 bg-card px-3 py-3 text-left align-top shadow-[1px_0_0_var(--border)] sm:w-auto sm:px-4 sm:shadow-none">
                          <span className="block text-sm font-semibold">{INDICATORS[k].label}</span>
                          <span className="block text-[11px] font-normal text-muted-foreground">{INDICATORS[k].question}</span>
                        </th>
                        {schools.map((s) => (
                          <td key={s.unit_id} className="px-4 py-3 align-top">
                            <TrendIndicatorCell school={s} indicator={k} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {historyFiles && (
                <HistorySourceNote
                  keys={["avg_paid_all", "applicants", "acceptance_rate", ...Object.values(RACE_SERIES)]}
                  files={historyFiles}
                  range={{ academic: defaultWindow(historyFiles.meta, "academic"), fall: defaultWindow(historyFiles.meta, "fall") }}
                />
              )}
            </section>
          )}

          <Group domain="admissions" title="Admissions">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <CompareMetric label="Acceptance rate" term="acceptance-rate" schools={schools} get={METRICS.acceptance.get} format={pctSmart} flag={{ which: "min", text: "Most selective" }} />
              <CompareMetric label="Applicants" term="applicants" schools={schools} get={METRICS.applicants.get} format={compact} flag={{ which: "max", text: "Most" }} />
              <CompareMetric label="Yield rate" term="yield" schools={schools} get={METRICS.yield.get} format={(v) => pct(v)} max={1} flag={{ which: "max", text: "Highest" }} />
            </div>
          </Group>

          <Group domain="scores" title="Test scores">
            <div className="grid gap-4 md:grid-cols-2">
              <ScoreCompare schools={schools} test="sat" />
              <ScoreCompare schools={schools} test="act" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <CompareMetric label="Submitted SAT" term="test-submission" schools={schools} get={(s) => s.admissions.test_submission_rate_sat} format={(v) => pct(v)} max={1} />
              <CompareMetric label="Submitted ACT" term="test-submission" schools={schools} get={(s) => s.admissions.test_submission_rate_act} format={(v) => pct(v)} max={1} />
            </div>
          </Group>

          <Group domain="access" title="Students">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <CompareMetric label="Undergrads" term="undergrad-enrollment" schools={schools} get={METRICS.enrollment.get} format={compact} flag={{ which: "max", text: "Largest" }} />
              <CompareMetric label="Pell Grant share" term="pell-grant" schools={schools} get={METRICS.pell.get} format={(v) => pct(v)} max={1} flag={{ which: "max", text: "Highest" }} />
              <CompareMetric label="First-gen share" term="first-gen" schools={schools} get={METRICS.firstGen.get} format={(v) => pct(v)} max={1} flag={{ which: "max", text: "Highest" }} />
              <CompareMetric label="Diversity index" term="diversity-index" schools={schools} get={METRICS.diversity.get} format={(v) => v.toFixed(2)} max={1} flag={{ which: "max", text: "Most" }} />
            </div>
            {/* Descriptive, not better or worse, so no "Highest" flags. */}
            <div className="grid gap-4 md:grid-cols-3">
              <CompareMetric label="Men" term="gender-balance" schools={schools} get={METRICS.menShare.get} format={(v) => pct(v)} max={1} />
              <CompareMetric label="Part-time students" term="part-time-student" schools={schools} get={METRICS.partTime.get} format={(v) => pct(v)} max={1} />
              <CompareMetric label="Students 25 and older" term="adult-students" schools={schools} get={METRICS.adults.get} format={(v) => pct(v)} max={1} />
            </div>
            <div className="rounded-3xl border bg-card p-4 sm:p-6">
              <h3 className="mb-5 flex items-center gap-1 font-display text-base font-bold">
                Race & ethnicity <InfoTip term="race-ethnicity" />
              </h3>
              <div className="space-y-5">
                {schools.map((s, i) => (
                  <div key={s.unit_id} className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-center">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                      {shortName(s)}
                    </span>
                    {s.demographics.racial_diversity ? (
                      <StackedBar data={s.demographics.racial_diversity} height="h-6" showLegend={false} label={s.name} />
                    ) : (
                      <span className="text-sm text-muted-foreground">Not reported</span>
                    )}
                  </div>
                ))}
              </div>
              <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-4 text-xs">
                {DEMOGRAPHIC_CATEGORIES.map((c) => (
                  <li key={c.key} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.label}
                  </li>
                ))}
              </ul>
            </div>
          </Group>

          <Group domain="value" title="Cost & outcomes">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <CompareMetric label="Average cost, all students" term="average-cost" schools={schools} get={METRICS.avgCost.get} format={moneyCompact} max={80000} flag={{ which: "min", text: "Lowest" }} />
              <CompareMetric label="Aid generosity" term="aid-generosity" schools={schools} get={METRICS.aidGenerosity.get} format={(v) => pct(v)} max={1} flag={{ which: "max", text: "Most" }} />
              <CompareMetric label="Net price, with grants" term="net-price" schools={schools} get={METRICS.netPrice.get} format={moneyCompact} max={80000} flag={{ which: "min", text: "Lowest" }} />
              <CompareMetric label="Median earnings, 10 yrs" term="median-earnings" schools={schools} get={METRICS.earnings.get} format={moneyCompact} flag={{ which: "max", text: "Highest" }} />
              <CompareMetric label="Graduation rate" term="graduation-rate" schools={schools} get={METRICS.gradRate.get} format={(v) => pct(v)} max={1} flag={{ which: "max", text: "Highest" }} />
              <CompareMetric label="Median debt" term="median-debt" schools={schools} get={METRICS.debt.get} format={moneyCompact} flag={{ which: "min", text: "Lowest" }} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <CompareMetric label="First-years receiving grants" term="grant-aid" schools={schools} get={(s) => s.aid?.grant_pct ?? null} format={(v) => pct(v)} max={1} flag={{ which: "max", text: "Most" }} />
              <CompareMetric label="Average grant (recipients)" term="grant-aid" schools={schools} get={(s) => s.aid?.grant_avg ?? null} format={moneyCompact} flag={{ which: "max", text: "Largest" }} />
            </div>
            <NetPriceCompare schools={schools} year={citeField("cost.net_price_by_income").year} />
            <MultiSourceNote schools={schools} fields={COST_FIELDS} />
          </Group>

          {majorOptions.length > 0 && (
            <Group domain="value" title="Your major">
              <p className="max-w-3xl text-sm text-muted-foreground">
                Pick a field of study to see which of these colleges award bachelor&apos;s degrees in it, how many, and what graduates earn{" "}
                <Term term="earnings-after-completion">after completion</Term>.
              </p>
              <MajorPicker ids={ids.join(",")} options={majorOptions} selected={selectedMajor} />
              {selectedMajor && <YourMajorBars title={majorTitles.get(selectedMajor)!} rows={majorRows} />}
              <MultiSourceNote schools={schools} fields={["detail.majors", "detail.programs"]} />
            </Group>
          )}

          {historyFiles && thenAndNow.some((m) => m.rows.length > 0) && (
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight sm:text-2xl">
                <span className="h-6 w-1.5 rounded-full bg-primary" />
                Then &amp; now
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                How each college changed over the last 10 years of federal data. Money is <Term term="inflation-adjusted">after inflation</Term>.
              </p>
              <div className="rounded-3xl border bg-card p-4 sm:p-6">
                <ThenAndNow metrics={thenAndNow} />
              </div>
              <HistorySourceNote keys={["avg_paid_all", "acceptance_rate", "applicants", "undergrads", ...Object.values(RACE_SERIES)]} files={historyFiles} range={{ academic: defaultWindow(historyFiles.meta, "academic"), fall: defaultWindow(historyFiles.meta, "fall") }} />
            </section>
          )}

          {/* Data table: every value in one place (also the accessible view) */}
          <section className="space-y-4">
            <h2 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">All the numbers</h2>
            <div className="overflow-x-auto rounded-3xl border bg-card">
              <table className="w-full min-w-[480px] text-sm sm:min-w-[560px]">
                <thead className="border-b bg-surface-2">
                  <tr>
                    <th className="sticky left-0 z-10 bg-surface-2 px-3 py-3 text-left text-xs font-semibold text-muted-foreground sm:px-4">Metric</th>
                    {schools.map((s, i) => (
                      <th key={s.unit_id} className="px-4 py-3 text-left text-xs font-bold">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                          {shortName(s)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {TABLE_ROWS.map(([label, term, field, fmt]) => (
                    <tr key={label}>
                      <td className="sticky left-0 z-10 max-w-36 bg-card px-3 py-2.5 text-muted-foreground shadow-[1px_0_0_var(--border)] sm:max-w-none sm:px-4 sm:shadow-none">
                        <span className="inline-flex items-center gap-1">
                          {label} <InfoTip term={term} cited={citeField(field)} />
                        </span>
                      </td>
                      {schools.map((s) => (
                        <td key={s.unit_id} className="px-4 py-2.5 font-semibold">
                          {fmt(s) ?? <span className="font-normal text-muted-foreground">–</span>}
                          {fmt(s) !== null && <SourceChip cited={citeField(field, s)} className="ml-1.5 align-middle" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MultiSourceNote schools={schools} fields={TABLE_FIELDS} />
          </section>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

async function ScoreCompare({ schools, test }: { schools: School[]; test: "sat" | "act" }) {
  const { metricMedian } = await getData();
  const ranges = schools.map((s) => (test === "sat" ? satComposite(s) : s.admissions.act_composite_25_75));
  const present = ranges.filter((r): r is [number, number] => r !== null);
  const title = test === "sat" ? "SAT total" : "ACT composite";
  if (present.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed p-5 text-sm text-muted-foreground">
        None of these colleges report {title} ranges.
      </div>
    );
  }
  const minLo = Math.min(...present.map((r) => r[0]));
  const lo = test === "sat" ? Math.floor((minLo - 60) / 100) * 100 : Math.max(1, minLo - 4);
  const hi = test === "sat" ? 1600 : 36;
  const median = metricMedian(test === "sat" ? "sat" : "act");
  return (
    <div className="rounded-3xl border bg-card p-5">
      <h3 className="mb-4 flex items-center gap-1 font-display text-base font-bold">
        {title}, <Term term="middle-50">middle 50%</Term>
      </h3>
      <div className="space-y-3">
        {schools.map((s, i) => {
          const r = ranges[i];
          return (
            <div key={s.unit_id} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[6rem_1fr_5rem]">
              <span className="truncate text-xs font-semibold">{shortName(s)}</span>
              {r ? (
                <RangeBar low={r[0]} high={r[1]} scale={[lo, hi]} color={SLOT_COLORS[i]} medianMid={median ?? undefined} compact />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {s.admissions.test_policy === "not-considered" ? "Test-blind" : "Not reported"}
                </span>
              )}
              <span className="text-right text-sm font-bold whitespace-nowrap tabular-nums">{r ? `${r[0]}–${r[1]}` : "–"}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Axis runs {lo}–{hi}. The dark tick marks the national median midpoint.
      </p>
    </div>
  );
}

function opt<T>(v: T | null, f: (v: T) => string): string | null {
  return v === null ? null : f(v);
}

async function SinglePrompt({ school }: { school: School }) {
  const data = await getData();
  const similar = similarSchools(data, school, 4);
  return (
    <div className="pt-8">
      <p className="mb-4 text-muted-foreground">
        Add at least one more school to see the head-to-head. Here are a few that are a lot like {shortName(school)}:
      </p>
      <div className="grid gap-3 max-sm:rail max-sm:[--rail-item:72%] sm:grid-cols-2 lg:grid-cols-4">
        {similar.map(({ school: s, reasons }) => (
          <Link
            key={s.unit_id}
            href={`/compare?ids=${school.unit_id},${s.unit_id}`}
            className="group rounded-3xl border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10"
          >
            <Crest id={s.unit_id} name={s.name} size="md" />
            <p className="mt-3 font-display font-bold group-hover:text-primary">{s.name}</p>
            <p className="text-xs text-muted-foreground">{reasons.join(" · ")}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary">
              Compare <ArrowRight className="size-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

async function EmptyState() {
  const { getSchoolsByIds } = await getData();
  return (
    <div className="mx-auto max-w-4xl px-4 pt-16 pb-12 text-center sm:px-6">
      <span className="mx-auto inline-flex size-16 animate-pop-in items-center justify-center rounded-3xl bg-pop text-pop-foreground shadow-lg">
        <Swords className="size-8" />
      </span>
      <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
        Pick your <span className="highlight">contenders</span>
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
        Add up to four schools with the <b className="text-foreground">+ Compare</b> button on any card or profile, or
        start with a classic matchup.
      </p>
      <div className="mt-10 grid gap-3 text-left sm:grid-cols-2">
        {MATCHUPS.map((ids) => {
          const schools = getSchoolsByIds(ids);
          return (
            <Link
              key={ids.join()}
              href={`/compare?ids=${ids.join(",")}`}
              className="group flex items-center gap-3 rounded-3xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10"
            >
              <div className="flex -space-x-2">
                {schools.map((s) => (
                  <Crest key={s.unit_id} id={s.unit_id} name={s.name} size="md" className="ring-2 ring-card" />
                ))}
              </div>
              <span className="min-w-0 flex-1 font-semibold">{schools.map((s) => shortName(s)).join(" vs. ")}</span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          );
        })}
      </div>
      <Link href="/explore" className="mt-8 inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background">
        Browse all schools <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
