import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { AddStudentsForm } from "@/components/org/AddStudentsForm";
import { authConfigured, requireUser } from "@/lib/auth";
import { ORG_INVITATION_DAYS } from "@/lib/org-rules";
import { myOrganization } from "@/lib/orgs";

export const metadata: Metadata = { title: "Add students", robots: { index: false, follow: false } };

/** /org/students/new (specs "How a student joins"): invite one or several students by email. */
export default async function AddStudentsPage() {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/org/students/new");
  const org = await myOrganization();
  if (!org) redirect("/org");
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/org" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Caseload
      </Link>
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Add students</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each student gets a link to join {org.name}. It works for {ORG_INVITATION_DAYS} days.</p>
      </div>
      <AddStudentsForm orgId={org.id} />
    </div>
  );
}
