import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { collegeViewers, viewTimes } from "@/lib/admin/college-views";
import { viewPageLabel } from "@/lib/college-views";
import { topicOf } from "@/lib/profile-topics";
import { getData } from "@/lib/data";

export const metadata: Metadata = { title: "Who's looking", robots: { index: false, follow: false } };

const pageLabel = (page: string) => viewPageLabel(page, (k) => topicOf(k)?.label);

/**
 * /admin/colleges/[unit]/views (specs/product/college-views.md): everyone who has opened the college, most views first,
 * each linking to that person's times; with ?signed_out=1, each signed-out visit's time and page.
 */
export default async function CollegeViewsPage({ params, searchParams }: PageProps<"/admin/colleges/[unit]/views">) {
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
      <PageHeader
        back={
          <Link href={`/admin/colleges/${unit}#views`} className="text-muted-foreground underline-offset-4 hover:underline">
            {school.name}
          </Link>
        }
        title={signedOut ? "Signed-out visits" : "Who's looking"}
        subtitle={`${looking.total.toLocaleString("en-US")} views · ${looking.people.toLocaleString("en-US")} signed-in people · ${looking.signedOut.toLocaleString("en-US")} signed out`}
      />
      {signedOut ? (
        <Panel title={`${times.length} ${times.length === 1 ? "visit" : "visits"}`}>
          {times.length === 0 ? (
            <Empty>No signed-out visits.</Empty>
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
        <Panel title="Everyone">
          {looking.viewers.length === 0 ? (
            <Empty>No views recorded yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-4 font-medium">Who</th>
                    <th className="py-1.5 pr-4 text-right font-medium">Views</th>
                    <th className="py-1.5 pr-4 font-medium">First</th>
                    <th className="py-1.5 font-medium">Last</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {looking.viewers.map((v) => (
                    <tr key={v.userId ?? "signed-out"}>
                      <td className="py-1.5 pr-4">
                        <Link
                          href={v.userId ? `/admin/people/${v.userId}/views?unit=${unit}` : `/admin/colleges/${unit}/views?signed_out=1`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {v.userId ? (v.name ?? v.email ?? "No name") : "Signed-out visitors"}
                        </Link>
                        {v.userId && v.name && v.email && <span className="block text-xs break-all text-muted-foreground">{v.email}</span>}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{v.views.toLocaleString("en-US")}</td>
                      <td className="py-1.5 pr-4 tabular-nums whitespace-nowrap">{fmtDateTime(v.firstViewed)}</td>
                      <td className="py-1.5 tabular-nums whitespace-nowrap">{fmtDateTime(v.lastViewed)}</td>
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
