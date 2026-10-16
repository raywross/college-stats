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
import {
  CoursesGuideStub,
  EdGuideStub,
  InterestGuideStub,
  RecommendersGuideStub,
  StoryGuideStub,
  TestGuideStub,
} from "@/components/planner/guides/stubs";
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
  courses: { Component: CoursesGuideStub },
  recommenders: { Component: RecommendersGuideStub },
  ed: { Component: EdGuideStub },
};
