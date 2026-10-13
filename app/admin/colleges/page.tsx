import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { getData } from "@/lib/data";
import { isHighSchoolId } from "@/lib/high-school-core";
import { getHighSchool, searchHighSchools } from "@/lib/high-schools";
import { pctSmart } from "@/lib/format";
import { MultiSourceNote } from "@/components/sources/MultiSourceNote";
import { TopBars } from "@/components/admin/ViewCharts";
import { topViewedColleges } from "@/lib/admin/college-views";

/** The "Most viewed" windows: ?views=7 | 30 (default) | all. */
const VIEW_WINDOWS = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;

export const metadata: Metadata = { title: "Colleges", robots: { index: false, follow: false } };

/**
 * /admin/colleges?q=… (specs/product/admin.md "The console"): find a college by name, alias, or unit id, or a high
 * school by name or NCES/PSS id, and open its console page with the hidden values. An exact unit id or high-school id
 * opens its page directly. With no search, the ten most viewed colleges (college_views) over 7 days, 30 days, or all
 * time (?views=).
 */
export default async function CollegesPage({ searchParams }: PageProps<"/admin/colleges">) {
  await connection();
  await requireAdmin();
  const params = await searchParams;
  const raw = params.q;
  const windowKey = Array.isArray(params.views) ? params.views[0] : params.views;
  const viewWindow = VIEW_WINDOWS.find((w) => w.key === windowKey) ?? VIEW_WINDOWS[1];
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const { getSchoolById, getSchoolsByIds, searchSchools } = await getData();
  if (q && getSchoolById(q)) redirect(`/admin/colleges/${q}`);
  if (q && isHighSchoolId(q) && (await getHighSchool(q))) redirect(`/admin/high-schools/${q}`);
  const colleges = q ? searchSchools(q, 25) : [];
  const cited = getSchoolsByIds(colleges.map((c) => c.id));
  const highSchools = q.length >= 3 ? await searchHighSchools({ q, limit: 15 }) : [];
  const mostViewed = q ? [] : await topViewedColleges(viewWindow.days);

  return (
    <>
      <PageHeader
        title="Colleges"
        subtitle={
          <>
            A college&apos;s hidden values (selectivity, GPA, derived fields) and its data health; a high school&apos;s pooled course counts. Every college&apos;s{" "}
            <Link href="/admin/selectivity" className="font-semibold text-primary underline-offset-4 hover:underline">
              selectivity history
            </Link>
            .
          </>
        }
      />
      <form action="/admin/colleges" method="get" role="search" className="flex max-w-xl gap-2">
        <label htmlFor="college-search" className="sr-only">
          Search colleges and high schools
        </label>
        <input
          id="college-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="College or high school name, or an id"
          className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
        />
        <button type="submit" className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Search
        </button>
      </form>
      <div className="mt-6 space-y-6">
        {!q && (
          <Panel
            title="Most viewed"
            id="most-viewed"
            aside={
              <span className="flex gap-1.5">
                {VIEW_WINDOWS.map((w) => (
                  <Link
                    key={w.key}
                    href={w.key === "30" ? "/admin/colleges" : `/admin/colleges?views=${w.key}`}
                    aria-current={w === viewWindow ? "true" : undefined}
                    className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs ${w === viewWindow ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {w.label}
                  </Link>
                ))}
              </span>
            }
          >
            {mostViewed.length === 0 ? (
              <Empty>No college pages viewed {viewWindow.days === null ? "yet" : `in the last ${viewWindow.days} days`}.</Empty>
            ) : (
              <TopBars
                unit={["view", "views"]}
                rows={mostViewed.map((c) => ({
                  key: c.unitId,
                  label: c.name,
                  sub: `${c.people} signed-in ${c.people === 1 ? "person" : "people"} · ${c.signedOut} signed-out ${c.signedOut === 1 ? "view" : "views"}`,
                  value: c.views,
                  href: `/admin/colleges/${c.unitId}#views`,
                }))}
              />
            )}
          </Panel>
        )}
        {!q ? (
          <Empty>
            Search a college by name or IPEDS unit id, or a high school by name or id. Every college&apos;s data health is on{" "}
            <Link href="/admin/health" className="font-semibold text-primary underline-offset-4 hover:underline">
              Health
            </Link>
            .
          </Empty>
        ) : (
          <>
            <section aria-labelledby="college-results">
              <h2 id="college-results" className="mb-2 text-sm font-semibold text-muted-foreground">
                Colleges
              </h2>
              {colleges.length === 0 ? (
                <Empty>No college matches &ldquo;{q}&rdquo;.</Empty>
              ) : (
                <ul className="divide-y rounded-2xl border bg-card">
                  {colleges.map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/colleges/${c.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3.5 hover:bg-muted/50">
                        <span className="font-semibold break-words">{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.city}, {c.state} · {c.acceptance === null ? "no admit rate" : `${pctSmart(c.acceptance)} admitted`} · {c.id}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="hs-results">
              <h2 id="hs-results" className="mb-2 text-sm font-semibold text-muted-foreground">
                High schools
              </h2>
              {q.length < 3 ? (
                <Empty>Type at least three letters to search high schools.</Empty>
              ) : highSchools.length === 0 ? (
                <Empty>No high school matches &ldquo;{q}&rdquo;.</Empty>
              ) : (
                <ul className="divide-y rounded-2xl border bg-card">
                  {highSchools.map((h) => (
                    <li key={h.id}>
                      <Link href={`/admin/high-schools/${h.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3.5 hover:bg-muted/50">
                        <span className="font-semibold break-words">{h.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[h.city, h.state].filter(Boolean).join(", ")} · {h.kind} · grades {h.grades}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {cited.length > 0 && <MultiSourceNote schools={cited} fields={["admissions.acceptance_rate"]} />}
          </>
        )}
      </div>
    </>
  );
}
