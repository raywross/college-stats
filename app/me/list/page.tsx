import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { authConfigured, currentStudent, requireUser } from "@/lib/auth";
import { getOrCreateDefaultList } from "@/lib/lists";

export const metadata: Metadata = { title: "My list", robots: { index: false } };

/**
 * /me/list (specs/product/saved-lists.md): the signed-in student's default list, created lazily. Redirects to
 * /me/lists/[id] so the rest of the UI (share, extra lists) only needs one page to maintain.
 */
export default async function MyListPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/me/list");

  const student = await currentStudent();
  if (!student) redirect("/me");
  const list = await getOrCreateDefaultList(student.id);
  if (!list) return <AuthUnavailable title="We couldn't open your list" />;
  redirect(`/me/lists/${list.id}`);
}
