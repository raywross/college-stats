"use client";

/**
 * The plan's one notice (specs/planner/redesign/list.md "Around the list"): `view.notices[0]` as one sentence, or
 * nothing — at most one shows, where there used to be up to three. In the desktop plan's right column (U5's aside
 * composition), and at the top of the list on a phone (PlanList, `lg:hidden`). Reuses ListNotices' content, so
 * there's one place that knows how to word each notice kind. The ED II offer and "ED would help most" notices are
 * gone: the Good ED opportunity pills replaced them (specs/planner/next-steps/ed-opportunities.md).
 */
import { ListNotices } from "@/components/planner/ListNotices";
import { guideHref } from "@/lib/planner/guides";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

export function PlanNotice({ ctx, view, className }: { ctx: PlanContext; view: PlanView; className?: string }) {
  const kind = view.notices[0];
  if (!kind) return null;
  // The balance line opens the Build your list guide (plan v3, specs/planner/v3/guides/list-size.md).
  const listGuideHref = ctx.student ? guideHref("list", { person: ctx.viewer.relation === "self" ? null : ctx.student.id, from: "notice" }) : null;
  return <ListNotices view={view} kind={kind} className={className} listGuideHref={listGuideHref} />;
}
