import { redirect } from "next/navigation";

/**
 * /household/[person]/lists/[id]: one of a person's extra lists (specs/product/household-hub.md "A person's page").
 * TODO(U4): render components/lists/ListPage.tsx here
 * (<ListPage listId={id} basePath={`/household/${person}/lists`} backHref={`/household/${person}`} />). Until then it
 * opens the list where it lives today.
 */
export default async function PersonExtraListPage({ params }: { params: Promise<{ person: string; id: string }> }) {
  const { id } = await params;
  redirect(`/me/lists/${encodeURIComponent(id)}`);
}
