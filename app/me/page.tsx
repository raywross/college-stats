import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { AccountsSetupError, authConfigured, currentStudent, requireUser, studentsICanSee } from "@/lib/auth";
import { isUuid } from "@/lib/household-hub";

export const metadata: Metadata = { title: "Your profile", robots: { index: false } };

/**
 * /me moved to the household hub (specs/product/household-hub.md): a student's numbers are the Numbers tab of their
 * page. Redirects to the signed-in student's own (or, from the old guardian picker's ?student=, that student's), and
 * to /household for someone with no student record.
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/me");

  let target = "/household";
  try {
    const { student: wanted } = await searchParams;
    if (isUuid(wanted) && (await studentsICanSee()).some((a) => a.student.id === wanted)) target = `/household/${wanted}/numbers`;
    else {
      const own = await currentStudent();
      if (own) target = `/household/${own.id}/numbers`;
    }
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Profiles aren't set up yet" />;
    throw err;
  }
  redirect(target);
}
