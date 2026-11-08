import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { adminPerson, logStudentView } from "@/lib/admin/people";
import { personCollegeViews, viewTimes } from "@/lib/admin/college-views";
import { viewPageLabel } from "@/lib/college-views";
import { topicOf } from "@/lib/profile-topics";
import { isUuid } from "@/lib/household-hub";

export const metadata: Metadata = { title: "Colleges viewed", robots: { index: false, follow: false } };

const pageLabel = (page: string) => viewPageLabel(page, (k) => topicOf(k)?.label);

/**
 * /admin/people/[user]/views (specs/product/college-views.md): every college the person has opened while signed in,
 * most viewed first; with ?unit=, each time they opened that college and which page. For a person with their own
 * student record, opening this records "Quad support viewed your information" for them.
 */
export default async function PersonViewsPage({ params, searchParams }: PageProps<"/admin/people/[user]/views">) {
  await connection();
  await requireAdmin();
  const { user } = await params;
  if (!isUuid(user)) notFound();
  const raw = (await searchParams).unit;
  const unit = Array.isArray(raw) ? raw[0] : raw;
  if (unit !== undefined && !/^[0-9]{6}$/.test(unit)) notFound();
  const person = await adminPerson(user);
  if (!person) notFound();
  const name = person.profile.display_name ?? person.auth?.email ?? "No name";
  const views = await personCollegeViews(user);
  if (person.ownStudent && views.colleges.length > 0) await logStudentView(person.ownStudent.id, "college views");
  const college = unit ? views.colleges.find((c) => c.unitId === unit) : undefined;
  const times = unit ? await viewTimes(unit, user) : [];

  return (
    <>
      <PageHeader help="views-log"
        back={
          <Link href={`/admin/people/${user}#views`} className="text-muted-foreground underline-offset-4 hover:underline">
            {name}
          </Link>
        }
        title={unit ? (college?.name ?? `College ${unit}`) : "Colleges viewed"}
        subtitle={
          unit ? (
            <>
              {name}&rsquo;s views, newest first ·{" "}
              <Link href={`/admin/data/colleges/${unit}#views`} className="underline-offset-4 hover:underline">
                Who else is looking
              </Link>{" "}
              ·{" "}
              <Link href={`/admin/people/${user}/views`} className="underline-offset-4 hover:underline">
                All their colleges
              </Link>
            </>
          ) : (
            `${views.total.toLocaleString("en-US")} views of ${views.colleges.length} colleges while signed in`
          )
        }
      />
      {unit ? (
        <Panel help="views-log" title={`${times.length} ${times.length === 1 ? "view" : "views"}`}>
          <ResponsiveTable
            rows={times.map((t, i) => ({ ...t, key: `${t.viewedAt}-${i}` }))}
            columns={
              [
                { key: "when", header: "When", role: "title", cell: (t) => fmtDateTime(t.viewedAt) },
                { key: "page", header: "Page", cell: (t) => pageLabel(t.page) },
              ] as readonly Column<(typeof times)[number] & { key: string }>[]
            }
            rowKey={(t) => t.key}
            caption="This college's views, newest first"
            empty="They haven't opened this college while signed in."
          />
        </Panel>
      ) : (
        <Panel help="views-log" title="Every college">
          <ResponsiveTable
            rows={views.colleges}
            columns={[
              {
                key: "college",
                header: "College",
                role: "title",
                cell: (c) => (
                  <Link href={`/admin/people/${user}/views?unit=${c.unitId}`} className="font-medium underline-offset-4 hover:underline">
                    {c.name}
                  </Link>
                ),
              },
              { key: "views", header: "Views", align: "right", cell: (c) => c.views.toLocaleString("en-US") },
              { key: "first", header: "First", role: "detail", cell: (c) => fmtDateTime(c.firstViewed) },
              { key: "last", header: "Last", cell: (c) => fmtDateTime(c.lastViewed) },
            ]}
            rowKey={(c) => c.unitId}
            caption="Every college viewed, most viewed first"
            empty="No college pages opened while signed in."
          />
        </Panel>
      )}
    </>
  );
}
