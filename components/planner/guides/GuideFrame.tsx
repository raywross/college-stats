/**
 * The frame every guide page shares (specs/planner/v3/now.md "The guide pattern"; build-plan.md "The guide page"): the
 * header (← Back to your advisor, the season and class year, the guide's title, and the open move's why under it, else
 * the guide's purpose), the guide's body, and the footer (GuideFooter: the move's Done and Skip, and the way back).
 * The plan's width (app/advisor/layout.tsx's container) without the tabs; one column, so it reads the same at 390 px.
 * Server component; the footer and the open telemetry are its two client islands.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GUIDES, type GuideFrom, type GuideSlug } from "@/lib/planner/guides";
import type { GuidePage } from "@/lib/planner/guides-server";
import { planHref } from "@/lib/planner/plan-tabs";
import { SEASON_LABELS } from "@/lib/planner/seasons";
import { isOpen } from "@/lib/planner/tasks";
import { taskSeason } from "@/lib/planner/moves";
import { GuideFooter } from "./GuideFooter";
import { GuideOpened } from "./GuideOpened";
import type { GuideProps } from "./types";
import { planViewerRole } from "@/lib/viewer-relation";

export interface GuideFrameProps extends GuideProps {
  slug: GuideSlug;
  from: GuideFrom;
  Component: GuidePage["Component"];
}

export function GuideFrame({ slug, from, Component, ctx, view, move, query, data, person }: GuideFrameProps) {
  const guide = GUIDES[slug];
  const classOf = ctx.gradYear !== null ? ` · Class of ${ctx.gradYear}` : "";
  const openMove = move && isOpen(move, ctx.today) ? move : null;
  const lead = move?.detail ?? guide.purpose;
  return (
    <article className="min-w-0 space-y-6" aria-labelledby="guide-title">
      <GuideOpened slug={slug} from={from} />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Link href={planHref({ person, tab: "next" })} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary hover:underline">
            <ArrowLeft className="size-4" aria-hidden />
            Back to your advisor
          </Link>
          <p className="text-sm text-muted-foreground">
            {SEASON_LABELS[ctx.season]}
            {classOf}
          </p>
        </div>
        <h1 id="guide-title" className="font-display text-2xl font-bold sm:text-3xl">
          {guide.title}
        </h1>
        <p className="max-w-prose text-muted-foreground">{lead}</p>
      </header>

      <Component ctx={ctx} view={view} move={move} query={query} data={data} person={person} />

      <GuideFooter
        move={openMove ? { id: openMove.id, kind: openMove.kind, season: taskSeason(openMove, ctx.gradYear, ctx.season) } : null}
        canEdit={ctx.viewer.canEdit}
        by={planViewerRole(ctx.viewer)}
        person={person}
      />
    </article>
  );
}

export default GuideFrame;
