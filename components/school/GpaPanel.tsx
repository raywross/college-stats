import { getData } from "@/lib/data";
import { admissionProfile, classRankSentence, IMPORTANCE_LABELS } from "@/lib/cds/admissions";
import type { FieldPath } from "@/lib/fields";
import { DOMAINS } from "@/lib/metrics";
import { pct } from "@/lib/format";
import type { GpaBands, School } from "@/lib/types";
import { Panel } from "@/components/profile/Panel";
import { ShowMore } from "@/components/ui/show-more";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { GpaChecker } from "./GpaChecker";
import { RigorLine } from "./RigorLine";

/** The values this panel shows: its source footnote and the admissions page's TOPIC_FIELDS. */
export const GPA_PANEL_FIELDS = [
  "reported.admission_profile.gpa.average",
  "reported.admission_profile.gpa.scale",
  "reported.admission_profile.gpa.submitted_share",
  "reported.admission_profile.gpa.bands.all",
  "reported.admission_profile.gpa.bands.with_test",
  "reported.admission_profile.gpa.bands.without_test",
  "reported.admission_profile.class_rank.top_tenth",
  "reported.admission_profile.class_rank.top_quarter",
  "reported.admission_profile.class_rank.submitted_share",
  "reported.admission_profile.factors.rigor",
] as const satisfies readonly FieldPath[];

/**
 * "High school record" (specs/data-expansion/cds-admissions.md, Display 4): enrolled first-years' average GPA (with
 * the weighted note), the standing caveat, the band bar with the GPA checker, and the class-rank line. Left off
 * when the CDS gives neither GPA nor class rank.
 */
export async function GpaPanel({ school, id }: { school: School; id?: string }) {
  const p = admissionProfile(school);
  const gpa = p?.gpa;
  const rank = p?.class_rank;
  if (!gpa && !rank) return null;
  const { citeField } = await getData();
  const cite = (leaf: string) => citeField(`reported.admission_profile.${leaf}` as FieldPath, school);
  const classYear = cite(gpa ? (gpa.average !== null ? "gpa.average" : "gpa.scale") : "class_rank.submitted_share").year;
  const weighted = gpa?.scale === "weighted";
  const columns = gpa
    ? (Object.fromEntries((["all", "with_test", "without_test"] as const).flatMap((c) => (gpa.bands[c] ? [[c, gpa.bands[c]]] : []))) as Partial<Record<"all" | "with_test" | "without_test", GpaBands>>)
    : {};
  const hasBands = Object.keys(columns).length > 0;
  const rankLine = classRankSentence(rank);
  // The college's own rating of course rigor (CDS C7), for the line under the checker that reads the visitor's courses.
  const rigorRating = p?.factors?.rigor ?? null;

  return (
    <Panel
      id={id}
      domain="admissions"
      eyebrow={classYear ? `${classYear} first-years` : "First-years"}
      title={gpa ? "First-years' high school GPA" : "First-years' high school class rank"}
      school={school}
      fields={GPA_PANEL_FIELDS}
      className="mt-14 sm:mt-20"
    >
      <div className="rounded-3xl border bg-card p-4 sm:p-6">
        {gpa && gpa.average !== null && (
          <div className="mb-4">
            <p className="font-display text-2xl font-extrabold">
              <MetricLabel term={weighted ? "weighted-gpa" : "high-school-gpa"} cited={cite("gpa.average")}>
                Average GPA {gpa.average.toFixed(2)}
                {weighted && ", weighted"}
              </MetricLabel>
            </p>
            {weighted && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                This average gives extra points for honors and AP courses, so it runs above 4.0 and can&apos;t be compared with an unweighted GPA.
              </p>
            )}
            {gpa.submitted_share !== null && gpa.submitted_share < 0.9 && (
              <p className="mt-1 text-sm text-muted-foreground">
                <MetricLabel cited={cite("gpa.submitted_share")}>From the {pct(gpa.submitted_share)} of first-years who reported a GPA.</MetricLabel>
              </p>
            )}
          </div>
        )}
        {gpa && (
          <p className="mb-4 max-w-2xl text-sm">
            High schools grade differently, and colleges recalculate or weight GPAs their own way, so compare this college only with itself.
          </p>
        )}
        {hasBands ? (
          <div>
            <p className="mb-2 text-sm font-semibold">
              <MetricLabel term="gpa-band" cited={cite(columns.all ? "gpa.bands.all" : columns.with_test ? "gpa.bands.with_test" : "gpa.bands.without_test")}>
                First-years by high school GPA (4.0 scale)
              </MetricLabel>
            </p>
            {weighted && <p className="mb-2 text-xs text-muted-foreground">At colleges with a weighted average, the &ldquo;4.0&rdquo; band seems to hold every GPA of 4.0 or more.</p>}
            <GpaChecker columns={columns} color={DOMAINS.admissions.color} />
          </div>
        ) : (
          gpa && <p className="text-sm text-muted-foreground">This college publishes an average but not a breakdown.</p>
        )}
        {rankLine && (
          <ShowMore label="Show class rank" hint="Where first-years stood in their high school class" className="mt-4">
            <p className="mt-4 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <MetricLabel term="class-rank" cited={cite("class_rank.submitted_share")}>
                {rankLine}
              </MetricLabel>
            </p>
          </ShowMore>
        )}
        <RigorLine
          college={school.name}
          rating={rigorRating ? { label: IMPORTANCE_LABELS[rigorRating].toLowerCase(), cited: cite("factors.rigor") } : null}
        />
        {!gpa && (
          <p className="mt-2 text-xs text-muted-foreground">
            This college doesn&apos;t publish first-years&apos; <Term term="high-school-gpa">high school GPA</Term>.
          </p>
        )}
      </div>
    </Panel>
  );
}
