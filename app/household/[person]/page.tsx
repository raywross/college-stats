import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { CounselorsSection } from "@/components/account/CounselorsSection";
import { OpenPlanCard } from "@/components/account/OpenPlanCard";
import { PersonHeader, personOwner } from "@/components/account/PersonHeader";
import { ListPage } from "@/components/lists/ListPage";
import { YourPart } from "@/components/planner/parents/YourPart";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { personListHref } from "@/lib/household-hub";
import { personPage } from "@/lib/households";
import { myCounselorGrants } from "@/lib/orgs";
import { isParent } from "@/lib/viewer-relation";
import { getOrCreateDefaultList, myLists } from "@/lib/lists";
import { myYourPart } from "@/lib/planner/store-parents";
import { yourPart } from "@/lib/planner/summary";
import { todayIso } from "@/lib/planner/context";

export const metadata: Metadata = { title: "Their list", robots: { index: false } };

/**
 * /household/[person] (specs/product/household-hub.md "A person's page", "Household cleanup (2026-10-12)"): inside
 * the hub's frame (app/household/layout.tsx: header, people strip, settings), the person area (PersonHeader: name
 * line, "⋯" menu, guardian banner, Plan | Numbers). `person` is a student id for a student and a user id for a
 * guardian (personHref() builds both); anyone outside the viewer's household is a 404.
 *
 * A student's colleges, levels, rounds, and deadlines live in the planner now (specs/chances/levels.md,
 * specs/planner/redesign/list.md): this route no longer embeds the old list board for a student, just
 * `OpenPlanCard` linking to `/plan?for=<id>` (`lib/household-hub.ts` `personListHref`). A guardian's own list has no
 * planner equivalent (the plan only ever shows a child's), so it still renders here, exactly as before, with the
 * tracking row under each college's "More" and, on your own, the Updates section
 * (components/lists/ListPage.tsx).
 */
export default async function PersonListPage({ params }: { params: Promise<{ person: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { person: id } = await params;
  await requireUser(`/household/${id}`);

  let person;
  let listId: string | null = null;
  try {
    person = await personPage(id);
    if (!person) notFound();
    if (person.kind !== "student") {
      const owner = personOwner(person);
      const lists = await myLists(owner);
      listId = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
      // The default list is created on first visit by whoever may write it: the guardian themselves.
      if (!listId && person.is_me) listId = (await getOrCreateDefaultList(owner))?.id ?? null;
    }
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }

  const first = (person.kind === "student" ? person.access.student.display_name : person.display_name)?.trim().split(/\s+/)[0] || null;
  const own = person.kind === "student" ? person.access.relation === "self" : person.is_me;

  // "Your part" above a guardian's own list (specs/planner/parents.md "The parent's tasks").
  const today = todayIso();
  const yourPartGroups = person.kind === "guardian" && person.is_me ? yourPart(await myYourPart(), today) : [];

  const planLink = personListHref(person.kind, id);
  // A parent's view of the child's counselors (counselor-portal.md "The student's side"), with the child's settings.
  const childId = person.kind === "student" && isParent(person.access.relation) ? person.access.student.id : null;
  const childGrants = childId ? (await myCounselorGrants().catch(() => [])).filter((g) => g.student_id === childId) : [];

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PersonHeader id={id} person={person} active="list" />
      </div>
      {yourPartGroups.length > 0 && <YourPart groups={yourPartGroups} today={today} />}
      {planLink ? (
        <OpenPlanCard href={planLink} first={first} own={own} />
      ) : listId ? (
        <ListPage listId={listId} basePath={`/household/${id}/lists`} showGuardianBanner={false} embedded />
      ) : (
        <section className="rounded-3xl border bg-card p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold">No list yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {own ? "You haven't" : first ? `${first} hasn't` : "They haven't"} started a list yet. Colleges added from a college&apos;s page, Explore, or Compare show up here.
          </p>
        </section>
      )}
      <CounselorsSection grants={childGrants} first={first ?? "Your student"} />
    </div>
  );
}
