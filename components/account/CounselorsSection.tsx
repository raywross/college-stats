import { AccountSection } from "@/components/account/AccountSection";
import { shortDate } from "@/lib/household-rules";
import { namesLine } from "@/lib/join-rules";
import type { CounselorGrantView } from "@/lib/org-rules";
import { CounselorGrantControls } from "./CounselorGrantControls";

/**
 * "Your counselors" (specs/product/counselor-portal.md "The student's side"): each counselor organization with a live
 * grant (my_counselor_grants()), its counselors' names, when it was granted, Can edit / View only, and End access.
 * On /account for the student's own record; on a child's household page for a parent (`first` is the child's first
 * name, and the words say "their"). Nothing at all when there are no grants: no upsell for a feature they didn't ask for.
 */
export function CounselorsSection({ grants, first = null }: { grants: CounselorGrantView[]; first?: string | null }) {
  if (grants.length === 0) return null;
  const forChild = first !== null;
  const whose = forChild ? `${first}'s` : "your";
  return (
    <AccountSection
      id="counselors"
      title={forChild ? `${first}'s counselors` : "Your counselors"}
      description={
        forChild
          ? `They see ${first}'s record, list, advisor, and essays, never your finances or your household.`
          : "They see your record, list, advisor, and essays, never your parents' finances. Each look shows below, under who viewed your information."
      }
    >
      <ul className="divide-y">
        {[...grants]
          .sort((a, b) => a.org_name.localeCompare(b.org_name))
          .map((g) => {
            const names = namesLine(g.counselor_names);
            return (
              <li key={g.grant_id} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{g.org_name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground break-words">
                    {names ? `${names} · ` : ""}Since {shortDate(g.granted_at)}
                  </p>
                </div>
                <CounselorGrantControls grantId={g.grant_id} orgName={g.org_name} canEdit={g.can_edit} whose={whose} />
              </li>
            );
          })}
      </ul>
    </AccountSection>
  );
}
