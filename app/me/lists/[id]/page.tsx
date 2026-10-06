import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { GuardianBanner } from "@/components/account/GuardianBanner";
import { ListBoard, type BoardItem } from "@/components/lists/ListBoard";
import { ListMeta, ListSwitcher, CsvControls, ShareToggle } from "@/components/lists/ListControls";
import { Term } from "@/components/ui/info-tip";
import { crestBrand } from "@/lib/brand";
import { authConfigured, requireUser } from "@/lib/auth";
import { openStudentAs } from "@/lib/households";
import { getListWithItems, myLists, namesFor, notesForItems } from "@/lib/lists";
import { getData } from "@/lib/data";
import { deadlineFor, upcomingDeadlines, type ListRound } from "@/lib/list-rules";
import { myHome } from "@/lib/home-store";
import { DEFAULT_WITHIN, distanceFromHome, exploreNearHref } from "@/lib/home";

export const metadata: Metadata = { title: "My list", robots: { index: false } };

function cycleStartYear(cycle: string | undefined): number {
  const match = cycle?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

/**
 * /me/lists/[id] (specs/product/saved-lists.md): one list's colleges grouped by category, with deadlines resolved
 * from the college's own reported data where the site has it, the balance line, notes, share link, and CSV
 * export/import. Read-only for a guardian without edit access (GuardianBanner).
 */
export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser(`/me/lists`);

  const withItems = await getListWithItems((await params).id);
  if (!withItems) notFound();
  const { list, items } = withItems;
  // A user's own list (a guardian's) has no student; its page arrives with the household hub.
  const studentId = list.student_id;
  if (!studentId) notFound();

  const access = await openStudentAs(studentId, "lists");
  if (!access) notFound();

  // The viewer's household's home: a student and the guardians who see their list measure from the same place.
  const [lists, { getSchoolById, citeField }, notesByItem, home] = await Promise.all([
    myLists(studentId),
    getData(),
    notesForItems(items.map((i) => i.id)),
    myHome(),
  ]);
  const addedByIds = [...new Set(items.map((i) => i.added_by).filter((x): x is string => !!x))];
  const names = await namesFor(addedByIds);

  const boardItems: BoardItem[] = items.map((item) => {
    const school = getSchoolById(item.unit_id);
    const logistics = school?.reported?.admissions_logistics ?? null;
    const profile = school?.reported?.admission_profile ?? null;
    const deadline = deadlineFor(item.round as ListRound | null, logistics, profile, cycleStartYear(logistics?.cycle), {
      text: item.deadline_text,
      date: item.deadline_date,
    });
    return {
      ...item,
      school: {
        unit_id: item.unit_id,
        name: school?.name ?? item.unit_id,
        city: school?.location.city ?? null,
        state: school?.location.state ?? null,
        brand: school ? crestBrand(school) : undefined,
        admitRate: school?.admissions.acceptance_rate ?? null,
        admitRateCited: school ? citeField("admissions.acceptance_rate", school) : null,
        avgCost: school?.cost?.avg_paid_all ?? null,
        avgCostCited: school ? citeField("cost.avg_paid_all", school) : null,
        distance: home && school ? distanceFromHome(school.location, home) : null,
        distanceCited: school ? citeField("location.lat", school) : null,
        deadline,
      },
      notes: notesByItem[item.id] ?? [],
      addedByName: item.added_by ? names[item.added_by] ?? null : null,
      addedBySelf: item.added_by === access.student.user_id,
    };
  });

  const upcoming = upcomingDeadlines(boardItems.map((i) => ({ id: i.id, name: i.school.name, deadline: i.school.deadline })), new Date());
  const compareIds = boardItems.slice(0, 4).map((i) => i.unit_id);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 sm:py-14 print:px-0">
      <div className="print:hidden">
        <Link href="/account" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Your account
        </Link>
      </div>

      {access.relation === "guardian" && <GuardianBanner studentName={access.student.display_name} canEdit={access.canEdit} className="print:hidden" />}

      <header className="flex flex-wrap items-center justify-between gap-3 print:block">
        <ListMeta list={list} />
        {boardItems.length > 0 && (
          <Link href={`/compare?ids=${compareIds.join(",")}`} className="inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold hover:bg-muted print:hidden">
            Compare these
          </Link>
        )}
      </header>

      <div className="print:hidden">
        <ListSwitcher lists={lists} currentId={list.id} />
      </div>

      {upcoming.length > 0 && (
        <section className="rounded-2xl border bg-pop/10 p-4 print:hidden">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <CalendarClock className="size-4" />
            Next 30 days
          </h2>
          <ul className="mt-1.5 space-y-1 text-sm">
            {upcoming.map((u) => (
              <li key={u.id}>
                {u.name} — {u.deadline.date}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ListBoard items={boardItems} canEdit={access.canEdit} viewerId={access.student.user_id ?? ""} />

      {boardItems.length > 0 && (
        <p className="text-xs text-muted-foreground print:hidden">
          {home ? (
            <>
              Distances are from your household&apos;s home in {home.place}, <Term term="distance-from-home">as the crow flies</Term>.
              {home.zip && (
                <>
                  {" "}
                  <Link href={exploreNearHref(home.zip)} className="font-semibold text-primary hover:underline">
                    Find more colleges within {DEFAULT_WITHIN} miles
                  </Link>
                  .
                </>
              )}
            </>
          ) : (
            <>
              Add your household&apos;s{" "}
              <Link href="/account/household#home" className="font-semibold text-primary hover:underline">
                home address
              </Link>{" "}
              to see how far each college is from home.
            </>
          )}
        </p>
      )}

      {access.canEdit && (
        <div className="space-y-3 print:hidden">
          <CsvControls listId={list.id} />
          <ShareToggle list={list} />
        </div>
      )}

      <p className="text-xs text-muted-foreground print:hidden">
        Categories are a starting point, not a verdict: <Term term="reach-school">Reach</Term>, <Term term="target-school">Target</Term>, and{" "}
        <Term term="likely-school">Likely</Term> are about fit and chance, together with cost and your own list.
      </p>
    </div>
  );
}
