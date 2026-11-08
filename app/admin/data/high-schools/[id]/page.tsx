import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Empty, Fields, Muted, PageHeader, Panel } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { requireAdmin } from "@/lib/admin/auth";
import { adminHighSchool } from "@/lib/admin/high-school";
import { COURSE_LIST_MIN_STUDENTS, type CourseCountRow } from "@/lib/admin/hidden";
import { dayLabel } from "@/lib/admin/ops-view";
import { gradeSpan, isHighSchoolId } from "@/lib/high-school-core";

export const metadata: Metadata = { title: "High school", robots: { index: false, follow: false } };

/**
 * /admin/data/high-schools/[id] (specs/product/admin.md "A high school"): the school, then its pooled course counts in full
 * (course, students) with the three-student line drawn, so the owner can see why a course is or isn't suggested; the
 * offering the course plan reads; the school's profile extraction status; and its graduation rate with its year. The
 * counts name no student. Server-rendered behind requireAdmin().
 */
export default async function HighSchoolPage({ params }: PageProps<"/admin/data/high-schools/[id]">) {
  await connection();
  await requireAdmin();
  const { id } = await params;
  if (!isHighSchoolId(id)) notFound();
  const hs = await adminHighSchool(id);
  if (!hs) notFound();
  const { school } = hs.view;
  const listed = hs.counts?.filter((c) => c.listed) ?? [];
  const below = hs.counts?.filter((c) => !c.listed) ?? [];

  return (
    <>
      <PageHeader help="high-school"
        back={
          <Link href="/admin/data/colleges" className="text-muted-foreground underline-offset-4 hover:underline">
            Colleges and high schools
          </Link>
        }
        title={school.name}
        subtitle={
          <>
            {[school.city, school.state].filter(Boolean).join(", ")} · {school.kind} · grades {gradeSpan(school.grades)} · id {school.id} ·{" "}
            <Link href={`/high-schools/${school.id}`} className="underline-offset-4 hover:underline">
              Public page
            </Link>
          </>
        }
      />

      <div className="space-y-5">
        <Panel help="high-school" title="Pooled course counts" id="course-counts" aside={<Muted>school_course_counts, in full</Muted>}>
          <p className="mb-3 text-sm text-muted-foreground">
            How many distinct students at this school list each AP or IB course. The course plan suggests a course only at {COURSE_LIST_MIN_STUDENTS} or more students
            (school_course_list()), and only when the school has no profile list of its own. Counts below the line are never shown on the site.
          </p>
          {hs.counts === null ? (
            <Empty>The counts couldn&apos;t be read: {hs.countsError}</Empty>
          ) : hs.counts.length === 0 ? (
            <Empty>No student at this school has listed an AP or IB course.</Empty>
          ) : (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                The {COURSE_LIST_MIN_STUDENTS}-student line: above it, suggested ({listed.length}); below it, never shown ({below.length}).
              </p>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Courses the plan lists ({listed.length})</h3>
                <CourseCountTable rows={listed} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Below the line ({below.length})</h3>
                <CourseCountTable rows={below} />
              </div>
            </div>
          )}
        </Panel>

        <Panel help="high-school" title="What the course plan reads" id="offering">
          {hs.offering ? (
            <div className="space-y-2 text-sm">
              <Fields
                items={[
                  { label: "Source", value: hs.offering.source ?? <Muted>Nothing on record</Muted> },
                  { label: "AP courses", value: hs.offering.apCount ?? <Muted>Unknown</Muted> },
                  { label: "IB", value: hs.offering.ib === null ? <Muted>Unknown</Muted> : hs.offering.ib ? "Offered" : "Not offered" },
                  { label: "Dual enrollment", value: hs.offering.dual === null ? <Muted>Unknown</Muted> : hs.offering.dual ? "Offered" : "Not offered" },
                ]}
              />
              {hs.offering.lines.length > 0 && <p className="text-muted-foreground">{hs.offering.lines.join(" ")}</p>}
              {hs.offering.cite && (
                <p className="text-xs text-muted-foreground">
                  Source: {hs.offering.cite.label}
                  {hs.offering.cite.year ? `, ${hs.offering.cite.year}` : ""}
                </p>
              )}
            </div>
          ) : (
            <Empty>No offering on record for this school.</Empty>
          )}
        </Panel>

        <Panel help="high-school" title="Profile and graduation rate" id="profile">
          <Fields
            items={[
              {
                label: "School profile",
                value: hs.profile ? (
                  <>
                    <a href={hs.profile.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      {hs.profile.label}
                    </a>{" "}
                    <Muted>· read {dayLabel(hs.profile.retrieved)}</Muted>
                  </>
                ) : (
                  <Muted>Not extracted (no profile file for this school)</Muted>
                ),
              },
              {
                label: "Four-year graduation rate",
                value: hs.gradRate ? (
                  <>
                    {hs.gradRate.display}{" "}
                    <Muted>
                      · {hs.gradRate.source}
                      {hs.gradRate.year ? `, ${hs.gradRate.year}` : ""}
                    </Muted>
                  </>
                ) : (
                  <Muted>Not published for this school</Muted>
                ),
              },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}

const courseCountColumns: readonly Column<CourseCountRow>[] = [
  {
    key: "course",
    header: "Course",
    role: "title",
    cell: (r) => (
      <>
        {r.name} <span className="font-mono text-xs font-normal text-muted-foreground">{r.key}</span>
      </>
    ),
  },
  { key: "students", header: "Students", align: "right", cell: (r) => r.students },
];

function CourseCountTable({ rows }: { rows: CourseCountRow[] }) {
  return <ResponsiveTable rows={rows} columns={courseCountColumns} rowKey={(r) => r.key} caption="Pooled course counts" empty="None." />;
}
