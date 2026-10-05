import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { profilesICanSee } from "@/lib/student-profile-store";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { CompletenessMeter } from "@/components/me/CompletenessMeter";
import { ProfileForm } from "@/components/me/ProfileForm";
import { ImportLocalProfile } from "@/components/me/ImportLocalProfile";
import { ViewingAsGuardianBanner } from "@/components/me/ViewingAsGuardianBanner";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Your profile", robots: { index: false } };

/**
 * /me (specs/product/student-profile.md "Display"): the student profile form, a completeness meter, and (for a
 * guardian) a picker over every student they can see. A guardian without edit access gets the form, disabled.
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  await requireUser("/me");

  let profiles;
  try {
    profiles = await profilesICanSee();
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Profiles aren't set up yet" />;
    throw err;
  }

  if (profiles.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">No student yet</h1>
        <p className="mt-3 text-muted-foreground">
          Add a student from <Link href="/account#household" className="font-semibold text-primary hover:underline">your household</Link> to see a profile here.
        </p>
      </div>
    );
  }

  const { student: studentParam } = await searchParams;
  const selected = profiles.find((p) => p.student.id === studentParam) ?? profiles[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Your profile</h1>
        <p className="mt-1 text-muted-foreground">Your own numbers, entered once and read everywhere: ScoreChecker, Explore&apos;s fit filters, and Compare.</p>
      </header>

      {profiles.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Which student">
          {profiles.map((p) => (
            <Link
              key={p.student.id}
              href={`/me?student=${p.student.id}`}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                p.student.id === selected.student.id ? "border-primary bg-primary/10" : "hover:bg-muted",
              )}
            >
              {p.student.display_name ?? "Student"}
              {p.relation === "guardian" && !p.canEdit && " (view only)"}
            </Link>
          ))}
        </nav>
      )}

      {selected.relation === "guardian" && <ViewingAsGuardianBanner studentName={selected.student.display_name} />}

      {selected.relation === "self" && <ImportLocalProfile studentId={selected.student.id} canEdit={selected.canEdit} />}

      <CompletenessMeter data={selected.data} />

      <ProfileForm studentId={selected.student.id} data={selected.data} canEdit={selected.canEdit} />
    </div>
  );
}
