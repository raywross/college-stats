import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PersonHeader, personOwner } from "@/components/account/PersonHeader";
import { ListPage } from "@/components/lists/ListPage";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { personPage } from "@/lib/households";
import { myLists } from "@/lib/lists";

export const metadata: Metadata = { title: "Their list", robots: { index: false } };

/**
 * /household/[person]/lists/[id] (specs/product/household-hub.md "A person's page"): one of the person's lists,
 * reached from the list switcher, under the same header and tabs as their default list. A list that isn't this
 * person's is a 404.
 */
export default async function PersonExtraListPage({ params }: { params: Promise<{ person: string; id: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { person: personId, id } = await params;
  await requireUser(`/household/${personId}/lists/${id}`);

  let person;
  try {
    person = await personPage(personId);
    if (!person) notFound();
    if (!(await myLists(personOwner(person))).some((l) => l.id === id)) notFound();
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 sm:py-14 print:px-0">
      <div className="print:hidden">
        <PersonHeader id={personId} person={person} active="list" />
      </div>
      <ListPage listId={id} basePath={`/household/${personId}/lists`} backHref={`/household/${personId}`} backLabel="Their list" showGuardianBanner={false} embedded />
    </div>
  );
}
