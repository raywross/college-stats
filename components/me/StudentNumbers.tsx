import { CompletenessMeter } from "@/components/me/CompletenessMeter";
import { ImportLocalProfile } from "@/components/me/ImportLocalProfile";
import { ProfileForm } from "@/components/me/ProfileForm";
import type { ProfileAccess } from "@/lib/student-profile-store";

/**
 * A student's numbers (specs/product/student-profile.md "Display"): the completeness meter and the profile form, plus
 * the one-time offer to save what the student entered before signing in (their own record only). Read-only for a
 * guardian without edit access. The Numbers tab of /household/[person] renders it; the page shows GuardianBanner.
 */
export function StudentNumbers({ profile }: { profile: ProfileAccess }) {
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        {profile.relation === "self" ? "Your own numbers" : "Their numbers"}, entered once and read everywhere: ScoreChecker, Explore&apos;s fit filters, and
        Compare.
      </p>
      {profile.relation === "self" && <ImportLocalProfile studentId={profile.student.id} canEdit={profile.canEdit} />}
      <CompletenessMeter data={profile.data} />
      <ProfileForm studentId={profile.student.id} data={profile.data} canEdit={profile.canEdit} />
    </div>
  );
}
