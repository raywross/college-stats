import { StagePanel } from "@/components/planner/StagePanel";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { FollowRow } from "@/components/planner/FollowRow";
import { FollowEveryoneButton, type FollowTarget } from "@/components/planner/FollowEveryoneButton";
import { VisitLog } from "@/components/planner/VisitLog";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { isPending, memberName } from "@/lib/household-rules";
import { myHouseholds } from "@/lib/households";
import { actionsOptional, actionsProgress, interestLine, interviewImportanceLine, orderForActions } from "@/lib/planner/actions";
import { InfoRequestButton } from "@/components/planner/row/actions";
import type { AnyCited } from "@/lib/lineage";
import type { PlanContext, PlanItem, PlanSchool } from "@/lib/planner/types";
import type { SocialNetwork } from "@/lib/types";

/**
 * Stage 3 (specs/planner/actions.md): one card per college, Dream first — the interest line, the follow row,
 * Request information, the visit log, and the C7 interview importance. "Follow everyone" at the top runs the
 * follow flow across every college with an unfollowed account. A server component; the interactive pieces
 * (FollowRow, the visit log, Follow everyone) are client children with only what they need.
 */
export default async function ActionsStage({ ctx }: { ctx: PlanContext }) {
  const items = orderForActions(ctx.items.filter((i) => !i.withdrawn_on));
  const householdNames = await householdNamesFor(ctx);
  const canFollow = ctx.viewer.canEdit && !ctx.viewer.isGuardian;

  const targets: FollowTarget[] = canFollow
    ? items.map((item) => ({
        itemId: item.id,
        schoolName: ctx.schools[item.unit_id]?.name ?? "this college",
        social: ctx.schools[item.unit_id]?.social as Partial<Record<SocialNetwork, string>> | null | undefined,
        followedNetworks: (item.followed_networks ?? []) as SocialNetwork[],
      }))
    : [];

  return (
    <StagePanel stage={3} ctx={ctx} actions={canFollow && <FollowEveryoneButton targets={targets} />}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add a college to the list to see its actions here.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const school = ctx.schools[item.unit_id];
            if (!school) return null;
            return (
              <ActionsCard
                key={item.id}
                item={item}
                school={school}
                canEdit={ctx.viewer.canEdit}
                canFollow={canFollow}
                today={ctx.today}
                householdNames={householdNames}
                visits={ctx.visits.filter((v) => v.item_id === item.id)}
              />
            );
          })}
        </ul>
      )}
    </StagePanel>
  );
}

function ActionsCard({
  item,
  school,
  canEdit,
  canFollow,
  today,
  householdNames,
  visits,
}: {
  item: PlanItem;
  school: PlanSchool;
  canEdit: boolean;
  canFollow: boolean;
  today: string;
  householdNames: readonly string[];
  visits: PlanContext["visits"];
}) {
  const social = school.social as Partial<Record<SocialNetwork, string>> | null | undefined;
  const hasAccounts = Boolean(social && Object.keys(social).length > 0);
  const interest = school.profile?.factors?.interest ?? null;
  const interview = school.profile?.factors?.interview ?? null;
  const optional = actionsOptional(interest);
  const progress = actionsProgress({
    hasAccounts,
    anyFollowed: (item.followed_networks?.length ?? 0) > 0,
    infoRequested: Boolean(item.info_requested_on),
    hasVisit: visits.length > 0,
  });

  return (
    <li className="rounded-2xl border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CollegeChip school={school} size="sm" link />
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {progress.done} of {progress.total} done
        </span>
      </div>

      <MetricLabel cited={school.cites["reported.admission_profile.factors.interest"] as AnyCited | undefined} className="mt-2 block text-sm">
        <Term term="demonstrated-interest">{optional ? "Interest: optional" : "Interest"}</Term>: {interestLine(interest)}
      </MetricLabel>

      <div className="mt-3 space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground">Follow</p>
        <FollowRow itemId={item.id} schoolName={school.name} social={social} followedNetworks={(item.followed_networks ?? []) as SocialNetwork[]} canFollow={canFollow} />
      </div>

      <div className="mt-3">
        <InfoRequestButton itemId={item.id} requestedOn={item.info_requested_on ?? null} canEdit={canEdit} admissionsUrl={school.links?.admissions ?? school.links?.website ?? null} />
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
          Visits <Term term="virtual-tour">and virtual tours</Term>
        </p>
        <VisitLog
          itemId={item.id}
          schoolName={school.name}
          visits={visits}
          canEdit={canEdit}
          today={today}
          householdNames={householdNames}
          distanceMiles={school.distanceMiles}
          bookUrl={school.links?.visit ?? school.links?.virtual_tour ?? null}
        />
      </div>

      <MetricLabel cited={school.cites["reported.admission_profile.factors.interview"] as AnyCited | undefined} className="mt-3 block text-xs text-muted-foreground">
        Interview: {interviewImportanceLine(interview)} Most interviews are informational.
      </MetricLabel>
    </li>
  );
}

/** The roster names for the "who's going" picker: the household that holds this plan's student (or the viewer's own, for a guardian's own list). */
async function householdNamesFor(ctx: PlanContext): Promise<string[]> {
  const households = await myHouseholds();
  const studentId = ctx.student?.id ?? null;
  const household = (studentId ? households.find((h) => h.members.some((m) => m.student_id === studentId)) : households[0]) ?? households[0] ?? null;
  if (!household) return [];
  return household.members.filter((m) => !isPending(m)).map((m) => memberName(m));
}
