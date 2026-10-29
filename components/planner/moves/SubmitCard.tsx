"use client";

/**
 * The Submit move (specs/planner/next-steps/applying.md "The moves"): "Submit {College} ({round} · {date})", the
 * deadline cited, the fee and waiver line (requirements.ts's fee line, same wording as the Apply stage), the
 * platform, a Common App link when that's the platform, and the supplement/recommendation sub-steps ticked inline.
 *
 * Decision: the college generator's `apply` task (generators/college.ts) already carries the round's own date, the
 * fee detail, and the field/edition to cite — it's the one shown here. The apply generator's own `submit` task
 * (generators/apply.ts, undated, "Submit the application") duplicates the same fact once this card exists, so it's
 * registered to this same component and rendered as nothing, keeping it out of the Now list (build-plan.md "U5
 * Applying": "read both generators and decide which built row is the move").
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { essaysHref } from "@/lib/essays/rows";
import { personFor } from "./MoveCard";
import { TaskRow } from "@/components/planner/TaskRow";
import { MetricLabel } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import type { AnyCited } from "@/lib/lineage";
import { ROUND_SHORT } from "@/lib/planner/generators/college";
import { PLATFORM_LABELS, platformsFor, requirementsFor } from "@/lib/planner/requirements";
import { markApplied, setPlatform } from "@/lib/planner/store-apply";
import { taskDateLabel } from "@/lib/planner/tasks";
import type { TaskKind } from "@/lib/planner/types";
import type { MoveCardProps } from "./types";

const SUBSTEP_KINDS: ReadonlySet<TaskKind> = new Set(["supplement", "recommendation"]);
const COMMON_APP_URL = "https://apply.commonapp.org";

export function SubmitCard({ task, ctx, onSkip, pending: skipPending }: MoveCardProps) {
  const item = ctx.items.find((i) => i.id === task.item_id) ?? null;
  const school = item ? ctx.schools[item.unit_id] : null;
  const [applied, setApplied] = useState(item?.applied_on !== null && item?.applied_on !== undefined);
  const [platform, setPlatformLocal] = useState(item?.application_platform ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  // The `submit` task duplicates this move once it exists: kept out of Now (see the file's note above).
  if (task.kind === "submit") return null;
  if (!item || !school) return null;

  const canEdit = ctx.viewer.canEdit;
  const date = taskDateLabel(task, ctx.today);
  const roundLabel = item.round ? ROUND_SHORT[item.round] : null;
  const title = `Submit ${school.name}${roundLabel || date ? ` (${[roundLabel, date].filter(Boolean).join(" · ")})` : ""}`;
  const cited = (task.source_field ? school.cites[task.source_field] : undefined) as AnyCited | undefined;
  const fee = requirementsFor(item, school, ctx.profile).find((r) => r.key === "fee") ?? null;
  const feeCite = (fee?.cite ? school.cites[fee.cite] : undefined) as AnyCited | undefined;
  const platforms = platformsFor(school);
  const subtasks = ctx.tasks.filter((t) => t.item_id === item.id && SUBSTEP_KINDS.has(t.kind)).sort((a, b) => a.position - b.position);
  const studentFirstName = ctx.student?.display_name?.trim().split(/\s+/)[0] || null;

  const choosePlatform = (value: string) => {
    setPlatformLocal(value);
    startTransition(async () => void (await setPlatform(item.id, (value || null) as typeof item.application_platform)));
  };

  const markIt = () =>
    startTransition(async () => {
      setMessage(null);
      setApplied(true);
      const r = await markApplied(item.id);
      if (!r.ok) {
        setApplied(false);
        return setMessage(r.message);
      }
      track("plan_applied", { round: item.round ?? "none" });
      router.refresh();
    });

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <p className="font-semibold">
        <MetricLabel cited={cited}>{title}</MetricLabel>
      </p>
      {fee && (
        <p className="mt-1 text-sm text-muted-foreground">
          <MetricLabel cited={feeCite}>{fee.text}</MetricLabel>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Platform</span>
          <select
            value={platform}
            disabled={!canEdit}
            onChange={(e) => choosePlatform(e.target.value)}
            className="h-9 rounded-full border bg-background px-2.5 text-xs font-semibold disabled:opacity-70"
          >
            <option value="">Not set</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        {platform === "common_app" && (
          <a href={COMMON_APP_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Common App <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        <Link href={essaysHref({ college: school.unit_id, person: personFor(ctx) })} className="text-xs font-semibold text-primary hover:underline">
          Essays for {school.name}
        </Link>
      </div>

      {subtasks.length > 0 && (
        <ul className="mt-3 divide-y border-t">
          {subtasks.map((t) => (
            <TaskRow key={t.id} task={t} school={school} canEdit={canEdit} today={ctx.today} studentFirstName={studentFirstName} showCollege={false} />
          ))}
        </ul>
      )}

      {message && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {message}
        </p>
      )}

      {canEdit && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending || applied}
            onClick={markIt}
            className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60"
          >
            {applied ? "Applied" : "Mark applied"}
          </button>
          <button type="button" disabled={pending || skipPending} onClick={() => onSkip(task)} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border">
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

export default SubmitCard;
