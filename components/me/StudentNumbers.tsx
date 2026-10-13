import { CompletenessMeter } from "@/components/me/CompletenessMeter";
import { ImportLocalProfile } from "@/components/me/ImportLocalProfile";
import { ProfileForm } from "@/components/me/ProfileForm";
import type { ProfileAccess } from "@/lib/student-profile-store";

/**
 * A student's numbers (specs/product/student-profile.md "Display"): the completeness meter and the profile form, plus
 * the one-time offer to save what the student entered before signing in (their own record only). Read-only for a
 * guardian without edit access. The Numbers tab of /household/[person] renders it; the page shows GuardianBanner.
 *
 * Trimmed 2026-10-12 (household-hub.md "Household cleanup"): `ProfileForm` no longer takes a graduation-year
 * default — that field moved to the planner's intake, whose "Class of" reads `students.grad_year` the same way.
 */
export function StudentNumbers({ profile }: { profile: ProfileAccess }) {
  // A guardian sees the same numbers as the student, AP exam scores included (owner, 2026-10-11).
  const data = profile.data;
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        {profile.relation === "self" ? "Your own numbers" : "Their numbers"}, entered once and read everywhere: ScoreChecker, Explore&apos;s fit filters, and
        Compare.
      </p>
      {profile.relation === "self" && <ImportLocalProfile studentId={profile.student.id} canEdit={profile.canEdit} />}
      <CompletenessMeter data={data} />
      <ProfileForm studentId={profile.student.id} data={data} canEdit={profile.canEdit} />
    </div>
  );
}
