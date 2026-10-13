import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
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
      <PageHeader
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
              <Link href={`/admin/colleges/${unit}#views`} className="underline-offset-4 hover:underline">
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
        <Panel title={`${times.length} ${times.length === 1 ? "view" : "views"}`}>
          {times.length === 0 ? (
            <Empty>They haven&rsquo;t opened this college while signed in.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-4 font-medium">When</th>
                    <th className="py-1.5 font-medium">Page</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {times.map((t, i) => (
                    <tr key={`${t.viewedAt}-${i}`}>
                      <td className="py-1.5 pr-4 tabular-nums whitespace-nowrap">{fmtDateTime(t.viewedAt)}</td>
                      <td className="py-1.5">{pageLabel(t.page)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="Every college">
          {views.colleges.length === 0 ? (
            <Empty>No college pages opened while signed in.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-4 font-medium">College</th>
                    <th className="py-1.5 pr-4 text-right font-medium">Views</th>
                    <th className="py-1.5 pr-4 font-medium">First</th>
                    <th className="py-1.5 font-medium">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {views.colleges.map((c) => (
                    <tr key={c.unitId}>
                      <td className="py-1.5 pr-4">
                        <Link href={`/admin/people/${user}/views?unit=${c.unitId}`} className="font-medium underline-offset-4 hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{c.views.toLocaleString("en-US")}</td>
                      <td className="py-1.5 pr-4 tabular-nums whitespace-nowrap">{fmtDateTime(c.firstViewed)}</td>
                      <td className="py-1.5 tabular-nums whitespace-nowrap">{fmtDateTime(c.lastViewed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
