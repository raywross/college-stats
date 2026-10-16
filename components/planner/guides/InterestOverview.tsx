"use client";

/**
 * The Show interest guide without a college (specs/planner/v3/guides/show-interest.md "The overview"): every college
 * on the list where interest is at least considered, in the move order (ED candidates first, then where interest is
 * important or very important, then considered), each with the college's C7 word (cited), what the plan already
 * records, and **Show interest →** to its own page. Colleges where interest isn't considered, and those that haven't
 * said, are folded below. Reached from the season's visit moves and the people line.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { edOpportunities } from "@/lib/planner/ed-opportunities";
import { guideHref } from "@/lib/planner/guides";
import { INTEREST_FIELD } from "@/lib/planner/interest";
import { c7Word, loggedParts, overviewRows, type OverviewRow } from "@/lib/planner/interest-guide";
import type { GuideProps } from "./types";

const LINK = "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ring-1 ring-border hover:bg-muted";

export function InterestOverview({ ctx, view, person, notOnList = false }: GuideProps & { notOnList?: boolean }) {
  const items = view.rows.map((r) => r.item);
  const edCandidates = edOpportunities(items, view.estimates, ctx.schools, { season: ctx.season, today: ctx.today });
  const { shown, notConsidered, unknown } = overviewRows(items, ctx.schools, edCandidates);

  const row = (r: OverviewRow) => {
    const school = ctx.schools[r.unitId];
    const item = ctx.items.find((i) => i.id === r.itemId);
    const cited = school?.cites[INTEREST_FIELD] as AnyCited | undefined;
    const word = c7Word(r.factor);
    const logged = item ? loggedParts(item, ctx.visits.filter((v) => v.item_id === item.id), ctx.today) : [];
    return (
      <li key={r.itemId} className="flex flex-col gap-2 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          <p className="font-semibold break-words">{r.name}</p>
          <p className="text-muted-foreground">
            {word ? (
              <MetricLabel cited={cited}>
                <span>Interest: {word}</span>
              </MetricLabel>
            ) : (
              <span>Interest: not reported</span>
            )}
            {r.group === "ed" && <span> · an early decision option</span>}
          </p>
          <p className="text-muted-foreground">{logged.length ? `Logged: ${logged.join(" · ")}` : "Nothing logged yet"}</p>
        </div>
        <Link href={guideHref("interest", { person, college: r.unitId })} className={LINK}>
          Show interest
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </li>
    );
  };

  return (
    <div className="min-w-0 space-y-5">
      {notOnList && <p className="text-sm text-muted-foreground">That college isn&apos;t on the list. Here is every college that is.</p>}
      <p className="max-w-prose text-sm text-muted-foreground">
        Where a college says <Term term="demonstrated-interest">applicant interest</Term> counts, in the order the plan works on them.
      </p>
      {shown.length ? (
        <ul className="space-y-2">{shown.map(row)}</ul>
      ) : (
        <p className="rounded-2xl border p-3 text-sm text-muted-foreground">No college on the list says interest counts.</p>
      )}
      {notConsidered.length > 0 && (
        <details className="rounded-2xl border p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
            Interest isn&apos;t considered at these {notConsidered.length}; visit for yourself.
          </summary>
          <ul className="mt-2 space-y-2">{notConsidered.map(row)}</ul>
        </details>
      )}
      {unknown.length > 0 && (
        <details className="rounded-2xl border p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">These haven&apos;t said whether interest counts.</summary>
          <ul className="mt-2 space-y-2">{unknown.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

export default InterestOverview;
