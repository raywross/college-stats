import { redirect } from "next/navigation";
import { connection } from "next/server";

/**
 * /household/[person]/numbers (specs/product/household-hub.md "Changed (2026-10-16): the Numbers tab becomes the
 * record"): redirects to the record overview, which replaced it. Kept as a small file so old links (bookmarks,
 * emails, #story anchors) still land somewhere.
 */
export default async function PersonNumbersPage({ params }: { params: Promise<{ person: string }> }) {
  await connection();
  const { person: id } = await params;
  redirect(`/household/${id}/record`);
}
