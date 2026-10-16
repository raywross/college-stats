/**
 * Props every guide component takes (specs/planner/v3/build-plan.md "The guide page"). Types only. The page
 * (app/plan/guide/[slug]/page.tsx) builds them once: the plan as the viewer sees it, the open move (or none), the
 * guide's query, and whatever the slug's server `load` returned. A client guide component receives `ctx`/`view`
 * serialized exactly as the plan's tabs do.
 */
import type { StandingLevel } from "@/lib/chances/types";
import type { PlanView } from "@/lib/planner/plan-view";
import type { PlanContext, PlanTask } from "@/lib/planner/types";

export interface GuideQuery {
  /** A college's unit id (`?college=`), unvalidated beyond its shape; the guide checks it against its own data. */
  college: string | null;
  /** `?level=`, a known level or null. */
  level: StandingLevel | null;
  /** `?move=`, the plan_tasks id as given (the page resolves it into `GuideProps.move`). */
  move: string | null;
}

export interface GuideProps {
  ctx: PlanContext;
  view: PlanView;
  /** The move that led here, when `?move=` names one of this plan's tasks; else null. */
  move: PlanTask | null;
  query: GuideQuery;
  /** The slug's server `load` result (lib/planner/guides-server.ts), or undefined without one. */
  data: unknown;
  /** The `?for=` value to carry on links (null for a student's own plan). */
  person: string | null;
}
