import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { AccountsSetupError, authConfigured, currentStudent, requireUser } from "@/lib/auth";
import { ownPersonPath } from "@/lib/household-hub";

export const metadata: Metadata = { title: "My list", robots: { index: false } };

/**
 * /me/list moved to the household hub (specs/product/household-hub.md): every person's list is the List tab of their
 * page, /household/<their student id, or their user id>.
 */
export default async function MyListPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const user = await requireUser("/me/list");
  let studentId: string | null;
  try {
    studentId = (await currentStudent())?.id ?? null;
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  redirect(ownPersonPath(studentId, user.id));
}
