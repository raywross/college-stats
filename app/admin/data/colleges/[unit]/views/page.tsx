import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader, Panel } from "@/components/admin/Panel";
import { ResponsiveTable } from "@/components/admin/ResponsiveTable";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { collegeViewers, viewTimes } from "@/lib/admin/college-views";
import { viewPageLabel } from "@/lib/college-views";
import { topicOf } from "@/lib/profile-topics";
import { getData } from "@/lib/data";

export const metadata: Metadata = { title: "Who's looking", robots: { index: false, follow: false } };

const pageLabel = (page: string) => viewPageLabel(page, (k) => topicOf(k)?.label);

/**
 * /admin/data/colleges/[unit]/views (specs/product/college-views.md): everyone who has opened the college, most views first,
 * each linking to that person's times; with ?signed_out=1, each signed-out visit's time and page.
 */
export default async function CollegeViewsPage({ params, searchParams }: PageProps<"/admin/data/colleges/[unit]/views">) {
  await connection();
  await requireAdmin();
  const { unit } = await params;
  if (!/^[0-9]{6}$/.test(unit)) notFound();
  const school = (await getData()).getSchoolById(unit);
  if (!school) notFound();
  const signedOut = (await searchParams).signed_out === "1";
  const looking = await collegeViewers(unit);
  const times = signedOut ? await viewTimes(unit, null) : [];

  return (
    <>
      <PageHeader help="views-log"
        back={
          <Link href={`/admin/data/colleges/${unit}#views`} className="text-muted-foreground underline-offset-4 hover:underline">
            {school.name}
          </Link>
        }
        title={signedOut ? "Signed-out visits" : "Who's looking"}
        subtitle={`${looking.total.toLocaleString("en-US")} views · ${looking.people.toLocaleString("en-US")} signed-in people · ${looking.signedOut.toLocaleString("en-US")} signed out`}
      />
      {signedOut ? (
        <Panel help="views-log" title={`${times.length} ${times.length === 1 ? "visit" : "visits"}`}>
          <ResponsiveTable
            rows={times.map((t, i) => ({ ...t, key: `${t.viewedAt}-${i}` }))}
            columns={[
              { key: "when", header: "When", role: "title", cell: (t) => fmtDateTime(t.viewedAt) },
              { key: "page", header: "Page", cell: (t) => pageLabel(t.page) },
            ]}
            rowKey={(t) => t.key}
            caption="Signed-out visits, newest first"
            empty="No signed-out visits."
          />
        </Panel>
      ) : (
        <Panel help="views-log" title="Everyone">
          <ResponsiveTable
            rows={looking.viewers}
            columns={[
              {
                key: "who",
                header: "Who",
                role: "title",
                cell: (v) => (
                  <>
                    <Link href={v.userId ? `/admin/people/${v.userId}/views?unit=${unit}` : `/admin/data/colleges/${unit}/views?signed_out=1`} className="font-medium underline-offset-4 hover:underline">
                      {v.userId ? (v.name ?? v.email ?? "No name") : "Signed-out visitors"}
                    </Link>
                    {v.userId && v.name && v.email && <span className="block text-xs break-all font-normal text-muted-foreground">{v.email}</span>}
                  </>
                ),
              },
              { key: "views", header: "Views", align: "right", cell: (v) => v.views.toLocaleString("en-US") },
              { key: "first", header: "First", role: "detail", cell: (v) => fmtDateTime(v.firstViewed) },
              { key: "last", header: "Last", cell: (v) => fmtDateTime(v.lastViewed) },
            ]}
            rowKey={(v) => v.userId ?? "signed-out"}
            caption="Everyone who has opened this college, most views first"
            empty="No views recorded yet."
          />
        </Panel>
      )}
    </>
  );
}
