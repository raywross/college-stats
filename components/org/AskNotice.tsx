import { AskNoticeList } from "@/components/org/AskNoticeList";
import { MarkAsksSeen } from "@/components/org/MarkAsksSeen";
import type { OpenOrgAsk } from "@/lib/org-rules";
import type { PlanContext } from "@/lib/planner/types";

/**
 * The asks notice at the top of the student's Next steps (specs/product/counselor-portal.md "Asking a student for
 * something"; rendered by components/planner/PlanTabs.tsx). Since round 5 it reads nothing and writes nothing while
 * rendering: the plan load reads `org_open_asks` in its first wave and closes the asks the facts already satisfy
 * (lib/planner/load.ts, lib/org-caseload.ts splitAsks), and hands over the rest (`asks`; null when not read: a
 * counselor looking, or a failed read). The asks the family hasn't seen are marked seen from the browser the first time
 * this notice shows (MarkAsksSeen, a Server Action), so the office reads "Seen" only once someone could have read it,
 * and the Next steps tab switches in place like the others. The student and a parent see it; a counselor reads asks on
 * the caseload's student page instead.
 */
export function AskNotice({ asks, ctx }: { asks: OpenOrgAsk[] | null; ctx: Pick<PlanContext, "student" | "viewer"> }) {
  if (!ctx.student || ctx.viewer.isCounselor || !asks || asks.length === 0) return null;
  const unseen = asks.filter((a) => a.seen_at === null).map((a) => a.id);
  return (
    <>
      <AskNoticeList asks={asks} person={ctx.viewer.relation === "self" ? null : ctx.student.id} canAct={ctx.viewer.canEdit || ctx.viewer.relation === "self"} />
      {unseen.length > 0 && <MarkAsksSeen ids={unseen} />}
    </>
  );
}
