import "server-only";
/**
 * The guide pages (specs/planner/v3/build-plan.md "The guide page"): for each slug, the component that renders the
 * guide's body and an optional server loader the page runs first (its result arrives as `GuideProps.data`). U1 ships
 * every slug with a stub; each guide's unit replaces its own entry (one line) with its component and loader.
 *
 * Server only: a loader may read the dataset or the database. The registry of which move opens which guide is the
 * pure lib/planner/guides.ts.
 */
import type { ComponentType } from "react";
import type { GuideProps, GuideQuery } from "@/components/planner/guides/types";
import { CoursesGuide, type CoursesGuideData } from "@/components/planner/guides/CoursesGuide";
import {
  EdGuideStub,
  InterestGuideStub,
  RecommendersGuideStub,
  StoryGuideStub,
  TestGuideStub,
} from "@/components/planner/guides/stubs";
import { courseTracks } from "../chances/depth";
import { coursePlanViewFor } from "../chances/course-plan-server";
import { offeringFor } from "../chances/rigor-server";
import { ListGuide } from "@/components/planner/guides/ListGuide";
import type { GuideSlug } from "./guides";
import { listGuideFor } from "./list-guide-server";
import type { PlanView } from "./plan-view";
import type { PlanContext } from "./types";

export interface GuidePage {
  Component: ComponentType<GuideProps>;
  load?: (ctx: PlanContext, view: PlanView, query: GuideQuery) => Promise<unknown>;
}

export const GUIDE_PAGES: Record<GuideSlug, GuidePage> = {
  list: { Component: ListGuide, load: listGuideFor },
  interest: { Component: InterestGuideStub },
  test: { Component: TestGuideStub },
  story: { Component: StoryGuideStub },
  courses: { Component: CoursesGuide, load: loadCoursesGuide },
  recommenders: { Component: RecommendersGuideStub },
  ed: { Component: EdGuideStub },
};

/**
 * The courses guide's load (specs/planner/v3/guides/ap-choices.md): the course plan the way `lib/planner/load.ts`
 * calls it, but regardless of the season's window (U7, beyond the brief's "the way it's called" — the guide is
 * reachable outside the registration window too, so `inWindow` is reported, not used to gate the read), plus the
 * depth course tracks the Numbers page reads (`courseTracks`, `components/me/CourseTracks.tsx`) for the track
 * sentence beside each row. Null without a profile.
 */
async function loadCoursesGuide(ctx: PlanContext): Promise<CoursesGuideData> {
  const profile = ctx.profile;
  if (!profile) return { plan: null, tracks: null };
  const [plan, { offering }] = await Promise.all([
    coursePlanViewFor({ profile, gradYear: ctx.gradYear, items: ctx.items, today: ctx.today, canEdit: ctx.viewer.canEdit }),
    offeringFor(profile.basics.highSchoolId, { studentMarks: profile.academics.schoolOffers }),
  ]);
  const tracks = courseTracks({
    courses: profile.academics.courses,
    coreAtTopLevel: profile.academics.coreAtTopLevel,
    offering,
    majors: profile.plans.intendedMajors,
    activities: profile.academics.activities,
  });
  return { plan, tracks };
}
