import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { num, pct } from "@/lib/format";
import { Block } from "@/components/profile/Panel";
import { MetricLabel } from "@/components/ui/info-tip";

type Count = "applicants" | "admitted" | "enrolled";

const COUNT_WORDS: Record<Count, string> = { applicants: "applied", admitted: "admitted", enrolled: "enrolled" };

interface Row {
  key: string;
  text: string;
  term: "approximate-figure" | "enrollment-target" | "deposits";
  path:
    | "reported.admissions.applicants"
    | "reported.admissions.admitted"
    | "reported.admissions.enrolled"
    | "reported.admissions.acceptance_rate"
    | "reported.admissions.enrollment_target"
    | "reported.admissions.deposits";
}

/**
 * The figures a college announced for its newest class that the exact funnel can't hold
 * (specs/college-reported-fall-figures.md Decisions 2 and 3): rounded figures ("more than 82,000" shown as "about
 * 82,000"), a class goal, deposits. Nothing here feeds a chart, a rate, the waffle, or the selectivity tier. The term
 * comes from the data, never from this file.
 */
export function AnnouncedFigures({
  school,
  cite,
  id,
}: {
  school: School;
  /** citeField bound to the dataset (server only). */
  cite: (path: FieldPath, school?: School) => Cited;
  id?: string;
}) {
  const rows = announcedRows(school);
  const r = school.reported?.admissions;
  if (!r || rows.length === 0) return null;
  return (
    <Block id={id} title={`Announced so far, ${r.entering_term}`}>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="text-sm">
            <MetricLabel term={row.term} cited={cite(row.path, school)} className="flex-wrap font-medium">
              {row.text}
            </MetricLabel>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        Figures the college announced before its Common Data Set; approximate numbers are shown as the college gave them and don&apos;t change the funnel above.
      </p>
    </Block>
  );
}

/** Whether the block has anything to say; the admissions page lists the section only then. */
export function hasAnnouncedFigures(school: School): boolean {
  return announcedRows(school).length > 0;
}

function announcedRows(school: School): Row[] {
  const r = school.reported?.admissions;
  if (!r) return [];
  const hasApprox = !!r.approx && Object.keys(r.approx).length > 0;
  const newer = r.year > (school.admissions.federal?.year ?? school.admissions.year ?? 0);
  if (!hasApprox && typeof r.enrollment_target !== "number" && typeof r.deposits !== "number" && !newer) return [];

  const rows: Row[] = [];
  for (const k of ["applicants", "admitted", "enrolled"] as const) {
    const v = r[k];
    if (r.approx?.[k] && typeof v === "number") {
      rows.push({ key: k, text: `about ${num(v)} ${COUNT_WORDS[k]}`, term: "approximate-figure", path: `reported.admissions.${k}` });
    }
  }
  if (r.approx?.acceptance_rate && typeof r.acceptance_rate === "number") {
    rows.push({ key: "rate", text: `about ${pct(r.acceptance_rate)} admitted`, term: "approximate-figure", path: "reported.admissions.acceptance_rate" });
  }
  if (typeof r.enrollment_target === "number") {
    rows.push({ key: "target", text: `Class goal: ${num(r.enrollment_target)}`, term: "enrollment-target", path: "reported.admissions.enrollment_target" });
  }
  if (typeof r.deposits === "number") {
    rows.push({ key: "deposits", text: `Deposits: ${num(r.deposits)}`, term: "deposits", path: "reported.admissions.deposits" });
  }
  return rows;
}
