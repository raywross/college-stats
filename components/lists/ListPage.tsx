import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft, CalendarClock, Eye } from "lucide-react";
import { GuardianBanner } from "@/components/account/GuardianBanner";
import { ListBoard, type BoardItem } from "@/components/lists/ListBoard";
import { ListMeta, ListSwitcher, CsvControls, ShareToggle } from "@/components/lists/ListControls";
import { UpdatesSection } from "@/components/me/UpdatesSection";
import { Term } from "@/components/ui/info-tip";
import { crestBrand } from "@/lib/brand";
import { getUser } from "@/lib/auth";
import { openStudentAs, personPage } from "@/lib/households";
import { getListWithItems, myLists, namesFor, notesForItems } from "@/lib/lists";
import { getData } from "@/lib/data";
import { deadlineFor, listOwner, upcomingDeadlines, type ListRecord, type ListRound } from "@/lib/list-rules";
import { myHome } from "@/lib/home-store";
import { DEFAULT_WITHIN, distanceFromHome, exploreNearHref } from "@/lib/home";

function cycleStartYear(cycle: string | undefined): number {
  const match = cycle?.match(/\d{4}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

/** Who is looking at the list, and what they may do with it. */
interface ListAccess {
  canEdit: boolean;
  /** The viewer owns the list: their own student record's, or their own as a user. Shows the Updates section. */
  isOwner: boolean;
  /** A guardian viewing a student's list: the banner's name and edit line. */
  guardianOf: { name: string | null; canEdit: boolean } | null;
  /** Someone else's own list (another guardian's, read by the household): whose. */
  othersList: { name: string | null } | null;
}

/**
 * Resolves the viewer's access to a list. A student's list goes through openStudentAs() (which logs a guardian's
 * read for the student's access log). A user's own list (a guardian's, household-hub.md "One list per person") is
 * the owner's to edit; any other household member who could read it (RLS already let them) sees it read-only, and
 * nothing is logged: the access log is about students' information. Null when the viewer can't see it.
 */
async function resolveAccess(list: ListRecord, viewerId: string): Promise<ListAccess | null> {
  if (list.student_id) {
    const access = await openStudentAs(list.student_id, "lists");
    if (!access) return null;
    return {
      canEdit: access.canEdit,
      isOwner: access.relation === "self",
      guardianOf: access.relation === "guardian" ? { name: access.student.display_name, canEdit: access.canEdit } : null,
      othersList: null,
    };
  }
  if (!list.user_id) return null;
  if (list.user_id === viewerId) return { canEdit: true, isOwner: true, guardianOf: null, othersList: null };
  const person = await personPage(list.user_id);
  const name = person?.kind === "guardian" ? person.display_name : ((await namesFor([list.user_id]))[list.user_id] ?? null);
  return { canEdit: false, isOwner: false, guardianOf: null, othersList: { name } };
}

/**
 * One list's page body (specs/product/saved-lists.md, household-hub.md "Display"): the colleges grouped by category
 * with deadlines resolved from the college's own reported data where the site has it, the tracking row, the balance
 * line, "Next 30 days", notes, share link, CSV export/import, and, for the list's owner, the Updates section filtered
 * to the list's colleges. Read-only for a guardian without edit access (GuardianBanner) and for another household
 * member's own list. A server component; the route around it handles sign-in.
 *
 * Rendered by /me/lists/[id] (basePath "/me/lists") and the household hub's /household/[person]/lists/[id] (basePath
 * "/household/<person>/lists"). `showGuardianBanner` lets a page that already shows the banner skip a second one;
 * `embedded` drops the page's own width, padding, and back link, for a page that wraps the list in its own layout
 * (a person's page with tabs).
 */
export async function ListPage({
  listId,
  basePath = "/me/lists",
  backHref = "/account",
  backLabel = "Your account",
  showGuardianBanner = true,
  embedded = false,
}: {
  listId: string;
  basePath?: string;
  backHref?: string;
  backLabel?: string;
  showGuardianBanner?: boolean;
  embedded?: boolean;
}) {
  const viewer = await getUser();
  if (!viewer) notFound();
  const withItems = await getListWithItems(listId);
  if (!withItems) notFound();
  const { list, items } = withItems;

  const access = await resolveAccess(list, viewer.id);
  if (!access) notFound();

  // The viewer's household's home: a student and the guardians who see their list measure from the same place.
  const [lists, { getSchoolById, citeField }, notesByItem, home] = await Promise.all([
    myLists(listOwner(list)),
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
      addedBySelf: item.added_by === viewer.id,
    };
  });

  const upcoming = upcomingDeadlines(boardItems.map((i) => ({ id: i.id, name: i.school.name, deadline: i.school.deadline })), new Date());
  const compareIds = boardItems.slice(0, 4).map((i) => i.unit_id);

  let siteUrl = "";
  if (access.isOwner) {
    const h = await headers();
    siteUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  }
  const othersName = access.othersList?.name?.trim() || null;

  return (
    <div className={embedded ? "space-y-6" : "mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 sm:py-14 print:px-0"}>
      {!embedded && (
        <div className="print:hidden">
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            {backLabel}
          </Link>
        </div>
      )}

      {showGuardianBanner && access.guardianOf && (
        <GuardianBanner studentName={access.guardianOf.name} canEdit={access.guardianOf.canEdit} className="print:hidden" />
      )}
      {access.othersList && (
        <p role="note" className="flex items-center gap-2 rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground print:hidden">
          <Eye className="size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">{othersName ? `${othersName}’s list` : "A guardian’s list"}</span> · Shared with the household to
            read; only {othersName ?? "they"} can change it.
          </span>
        </p>
      )}

      <header className="flex flex-wrap items-center justify-between gap-3 print:block">
        <ListMeta list={list} canEdit={access.canEdit} />
        {boardItems.length > 0 && (
          <Link href={`/compare?ids=${compareIds.join(",")}`} className="inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold hover:bg-muted print:hidden">
            Compare these
          </Link>
        )}
      </header>

      <div className="print:hidden">
        <ListSwitcher lists={lists} currentId={list.id} basePath={basePath} canEdit={access.canEdit} />
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

      <ListBoard items={boardItems} canEdit={access.canEdit} viewerId={viewer.id} />

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
        <Term term="likely-school">Likely</Term> are about fit and chance, together with cost and your own list. The{" "}
        <Term term="tracking">tracking row</Term> under each college keeps the rest: <Term term="updates">Updates</Term> (on by default) is what puts a
        college in your update emails.
      </p>

      {access.isOwner && (
        <section id="updates" className="scroll-mt-24 space-y-3 print:hidden">
          <h2 className="font-display text-xl font-bold sm:text-2xl">
            <Term term="update-digest">Updates</Term>
          </h2>
          <UpdatesSection userId={viewer.id} siteUrl={siteUrl} unitIds={items.map((i) => i.unit_id)} />
        </section>
      )}
    </div>
  );
}
