import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PersonHeader } from "@/components/account/PersonHeader";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { personPage } from "@/lib/households";
import { getOrCreateDefaultList, myLists } from "@/lib/lists";

export const metadata: Metadata = { title: "Their list", robots: { index: false } };

/**
 * /household/[person] (specs/product/household-hub.md "A person's page"): the person's name, the guardian banner when
 * a guardian is looking at a student, and the List tab (the default). `person` is a student id for a student and a
 * user id for a guardian (personHref() builds both); anyone outside the viewer's household is a 404.
 */
export default async function PersonListPage({ params }: { params: Promise<{ person: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { person: id } = await params;
  await requireUser(`/household/${id}`);

  let person;
  try {
    person = await personPage(id);
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (!person) notFound();

  // TODO(U4): render the list itself here with components/lists/ListPage.tsx
  // (<ListPage listId={list.id} basePath={`/household/${id}/lists`} backHref="/household" />), for a guardian's own
  // list too (lists.user_id), plus the Updates section under it. Until then this tab links to /me/lists/[id].
  let listId: string | null = null;
  if (person.kind === "student") {
    const studentId = person.access.student.id;
    const lists = await myLists(studentId);
    listId = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
    if (!listId && person.access.canEdit) listId = (await getOrCreateDefaultList(studentId))?.id ?? null;
  }

  const first = (person.kind === "student" ? person.access.student.display_name : person.display_name)?.trim().split(/\s+/)[0] || null;
  const own = person.kind === "student" ? person.access.relation === "self" : person.is_me;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <PersonHeader id={id} person={person} active="list" />
      <section className="rounded-3xl border bg-card p-5 sm:p-6">
        {listId ? (
          <>
            <h2 className="font-display text-xl font-bold">{own ? "Your list" : first ? `${first}'s list` : "Their list"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Colleges by category, with deadlines, status, notes, and distance from home.</p>
            <Link href={`/me/lists/${listId}`} className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
              Open the list
              <ArrowRight className="size-4" />
            </Link>
          </>
        ) : (
          <>
            <h2 className="font-display text-xl font-bold">No list yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {person.kind === "student"
                ? `${first ?? "This student"} hasn't started a list. Add colleges from any college's page, Explore, or Compare.`
                : own
                  ? "Your own list of colleges will be here. Add colleges from any college's page, Explore, or Compare."
                  : `${first ?? "This guardian"}'s own list of colleges will be here.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
