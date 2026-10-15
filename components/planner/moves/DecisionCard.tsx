"use client";

/**
 * "Record {College}'s decision (expected {date})" (specs/planner/next-steps/applying.md "The moves"; kind
 * `decision_expected`, generators/college.ts): the date cited, the outcome picker (recordDecision, built), and a
 * link to the Offers tab once admitted.
 */
import Link from "next/link";
import { OutcomePicker } from "@/components/planner/OutcomePicker";
import { MetricLabel } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { planHref } from "@/lib/planner/plan-tabs";
import { taskDateLabel } from "@/lib/planner/tasks";
import type { MoveCardProps } from "./types";

export function DecisionCard({ task, ctx }: MoveCardProps) {
  const item = ctx.items.find((i) => i.id === task.item_id) ?? null;
  const school = item ? ctx.schools[item.unit_id] : null;
  if (!item || !school) return null;

  const date = taskDateLabel(task, ctx.today);
  const cited = (task.source_field ? school.cites[task.source_field] : undefined) as AnyCited | undefined;

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <p className="font-semibold">
        <MetricLabel cited={cited}>
          Record {school.name}&apos;s decision{date ? ` (expected ${date})` : ""}
        </MetricLabel>
      </p>
      <div className="mt-3">
        <OutcomePicker itemId={item.id} outcome={item.outcome} decisionDate={item.decision_date} today={ctx.today} canEdit={ctx.viewer.canEdit} collegeName={school.name} compact />
      </div>
      {item.outcome === "admitted" && (
        <Link href={planHref({ person: ctx.student?.id ?? null, tab: "offers" })} className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
          See it on the Offers tab →
        </Link>
      )}
    </div>
  );
}

export default DecisionCard;
