import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PersonHeader, personOwner } from "@/components/account/PersonHeader";
import { ListPage } from "@/components/lists/ListPage";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { personPage } from "@/lib/households";
import { getOrCreateDefaultList, myLists } from "@/lib/lists";

export const metadata: Metadata = { title: "Their list", robots: { index: false } };

/**
 * /household/[person] (specs/product/household-hub.md "A person's page", "Redesign (2026-10-06)"): inside the hub's
 * frame (app/household/layout.tsx: header, people strip, settings), the person area (PersonHeader: name line, "⋯"
 * menu, guardian banner, List | Numbers) and List, the default: their default list, with the tracking row under each
 * college's "More" and, on your own, the Updates section (components/lists/ListPage.tsx). `person` is a student id for a student and a user
 * id for a guardian (personHref() builds both); anyone outside the viewer's household is a 404.
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
    const owner = personOwner(person);
    const lists = await myLists(owner);
    listId = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
    // The default list is created on first visit by whoever may write it: the person, or a guardian who can edit a student.
    const canCreate = person.kind === "student" ? person.access.canEdit : person.is_me;
    if (!listId && canCreate) listId = (await getOrCreateDefaultList(owner))?.id ?? null;
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }

  const first = (person.kind === "student" ? person.access.student.display_name : person.display_name)?.trim().split(/\s+/)[0] || null;
  const own = person.kind === "student" ? person.access.relation === "self" : person.is_me;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PersonHeader id={id} person={person} active="list" />
      </div>
      {listId ? (
        <ListPage listId={listId} basePath={`/household/${id}/lists`} showGuardianBanner={false} embedded />
      ) : (
        <section className="rounded-3xl border bg-card p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold">No list yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {own ? "You haven't" : first ? `${first} hasn't` : "They haven't"} started a list yet. Colleges added from a college&apos;s page, Explore, or Compare show up here.
          </p>
        </section>
      )}
    </div>
  );
}
