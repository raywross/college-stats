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
 * /admin/data/high-schools/[id] (specs/product/admin.md "A high school"; specs/product/admin-redesign.md "Data"): the
 * school, then its pooled course counts in full as two lists, "Courses the plan lists" and "Below the line", with the
 * three-student line stated in a sentence, so the owner can see why a course is or isn't suggested; the
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
        <Panel help="course-counts" title="Courses students list" id="course-counts">
          <p className="mb-4 max-w-prose text-sm text-muted-foreground">{courseLineSentence(COURSE_LIST_MIN_STUDENTS)}</p>
          {hs.counts === null ? (
            <Empty>The counts couldn&apos;t be read: {hs.countsError}</Empty>
          ) : hs.counts.length === 0 ? (
            <Empty>No student at this school has listed an AP or IB course.</Empty>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <CourseList id="listed" title="Courses the plan lists" rows={listed} empty={`No course has ${COURSE_LIST_MIN_STUDENTS} or more students yet.`} />
              <CourseList id="below" title="Below the line" rows={below} empty="Every course students list is above the line." muted />
            </div>
          )}
        </Panel>

        <Panel help="course-offering" title="What the course plan reads" id="offering">
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
    cell: (r) => r.name,
  },
  { key: "students", header: "Students", align: "right", cell: (r) => r.students },
];

/**
 * The threshold in a sentence, with no function or table names (specs/product/admin-redesign.md "Data"): the line is
 * the database's `c.students >= 3`, mirrored by COURSE_LIST_MIN_STUDENTS.
 */
function courseLineSentence(min: number): string {
  return `How many different students at this school list each AP or IB course. The course plan suggests a course once ${min} or more students list it, and only when the school has no course list of its own; a course below that line is never shown on the site, and no count names a student.`;
}

/** One of the two lists: each course's name and how many students list it, most first. */
function CourseList({ id, title, rows, empty, muted = false }: { id: string; title: string; rows: CourseCountRow[]; empty: string; muted?: boolean }) {
  return (
    <section aria-labelledby={`courses-${id}`} className={muted ? "text-muted-foreground" : ""}>
      <h3 id={`courses-${id}`} className="mb-1.5 text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h3>
      <ResponsiveTable rows={rows} columns={courseCountColumns} rowKey={(r) => r.key} caption={title} empty={empty} />
    </section>
  );
}
