"use client";

/**
 * The interest and visit moves' card (specs/planner/next-steps/interest-and-visits.md "The move"): title, the why
 * (the binding round for `visit_ed`, the college's own C7 answer for `show_interest`, cited through the date line
 * the way every move is), one line of what counts most, then the capture panel's own actions in order — Visit, an
 * information request, Follow — each already built (lib/planner/store-actions.ts) and each one tap. Nothing here
 * ticks the move directly: any logged act flips `hooks.interest`, and the generator simply stops including the
 * college next time (interest.ts's module comment), so there's no separate Done button, only **Not now**.
 */
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink } from "lucide-react";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { SOCIAL_GLYPHS } from "@/components/school/SocialIcons";
import { track } from "@/lib/analytics";
import { STANDING_LEVEL_LABELS } from "@/lib/chances/levels";
import type { StandingLevel } from "@/lib/chances/types";
import { followTargets, visitedState, visitPageLink } from "@/lib/planner/capture";
import { interestMoveText, type InterestMove } from "@/lib/planner/interest";
import { dayLabel } from "@/lib/planner/list-row";
import { logVisit, markInfoRequested, recordFollow } from "@/lib/planner/store-actions";
import { isOverdue, taskDateLabel } from "@/lib/planner/tasks";
import type { AnyCited } from "@/lib/lineage";
import type { SocialNetwork } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { MoveCardProps } from "./types";

const BUTTON = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold sm:min-h-9";
const PRIMARY = cn(BUTTON, "bg-foreground text-background");
const SECONDARY = cn(BUTTON, "ring-1 ring-border hover:bg-muted");
const READONLY = cn(BUTTON, "cursor-default text-muted-foreground opacity-60");

/** The rule a card's kind and the college's own C7 answer imply, for the shown-event's telemetry (PlanTask doesn't
 *  carry `InterestMove.rule`, since two rules share the `show_interest` kind). */
function ruleFor(kind: "visit_ed" | "show_interest", factor: "very_important" | "important" | "considered" | "not_considered" | null): InterestMove["rule"] {
  if (kind === "visit_ed") return "visit_ed";
  return factor === "considered" ? "considered" : "important";
}

export function InterestCard({ task, ctx, onSkip, pending }: MoveCardProps) {
  const router = useRouter();
  const [busy, startVisit] = useTransition();
  const [busyInfo, startInfo] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const item = task.item_id ? ctx.items.find((i) => i.id === task.item_id) : undefined;
  const school = item ? ctx.schools[item.unit_id] : undefined;
  const valid = !!item && !!school && (task.kind === "visit_ed" || task.kind === "show_interest");

  const factor = school?.profile?.factors?.interest ?? null;
  const level = item ? ctx.estimates[item.unit_id]?.group ?? null : null;
  const rule = valid ? ruleFor(task.kind as "visit_ed" | "show_interest", factor) : "visit_ed";

  useEffect(() => {
    if (valid) track("plan_interest_move_shown", { rule, level: (level ?? "none") as StandingLevel | "none" });
    // Once per mounted card, by task id; a card that fails `valid` renders nothing below, so there's nothing to
    // report as shown even if `rule`/`level` happen to change identity on an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  if (!item || !school || !valid) return null;

  const text = interestMoveText({ kind: task.kind as "visit_ed" | "show_interest" }, school);
  const cited = text.sourceField ? (school.cites[text.sourceField] as AnyCited | undefined) : undefined;
  const date = taskDateLabel(task, ctx.today);
  const overdue = isOverdue(task, ctx.today);
  const canEdit = ctx.viewer.canEdit;
  const canFollow = canEdit && !ctx.viewer.isGuardian;
  const visits = ctx.visits.filter((v) => v.item_id === item.id);
  const vState = visitedState(item.visited_on, visits, ctx.today);
  const visitLink = visitPageLink(school.links ?? null);
  const social = school.social as Partial<Record<SocialNetwork, string>> | null | undefined;
  const followed = (item.followed_networks ?? []) as SocialNetwork[];
  const targets = followTargets(social, followed);

  const act = (action: string, write: () => Promise<{ ok: boolean; message?: string }>, start: typeof startVisit) => {
    setError(null);
    start(async () => {
      const r = await write();
      if (!r.ok) {
        setError(r.message ?? "That didn't work. Try again in a moment.");
        return;
      }
      track("plan_interest_act", { action });
      router.refresh();
    });
  };

  return (
    <div className="rounded-3xl bg-card p-4 ring-1 ring-border" id={`move-${task.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">{text.title}</p>
        <MetricLabel cited={cited} className={cn("shrink-0 text-sm text-muted-foreground", overdue && "font-semibold text-destructive")}>
          <span>
            {overdue ? "Overdue · " : ""}
            {date ?? "this season"}
          </span>
        </MetricLabel>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        <Term term="demonstrated-interest" cited={cited}>
          {text.why}
        </Term>
        {level === "reach" || level === "target" ? <span className="ml-1 text-xs">({STANDING_LEVEL_LABELS[level]} for you)</span> : null}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">A registered visit or information session counts most; then contact or an information request; then opening its email; follows last.</p>

      <div className="mt-3 space-y-3">
        {/* Visit */}
        <div className="flex flex-wrap items-center gap-2">
          {vState.upcoming ? (
            <span className="text-sm text-muted-foreground">Visit planned for {dayLabel(vState.upcoming.on_date)}.</span>
          ) : (
            canEdit && (
              <button
                type="button"
                disabled={busy || pending}
                onClick={() => act("visit", () => logVisit(item.id, { kind: "campus_tour", onDate: ctx.today }), startVisit)}
                className={PRIMARY}
              >
                We visited
              </button>
            )
          )}
          {!canEdit && !vState.upcoming && <span className={READONLY}>We visited</span>}
          {visitLink && (
            <a href={visitLink.href} target="_blank" rel="noopener" className={SECONDARY}>
              {visitLink.label}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>

        {/* Information request */}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <button
              type="button"
              disabled={busyInfo || pending}
              onClick={() => act("request_info", () => markInfoRequested(item.id, true), startInfo)}
              className={SECONDARY}
            >
              We requested info
            </button>
          ) : (
            <span className={READONLY}>We requested info</span>
          )}
          {school.links?.admissions && (
            <a href={school.links.admissions} target="_blank" rel="noopener" className={SECONDARY}>
              Admissions page
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>

        {/* Follow */}
        {targets.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-2">
              {targets.map((t) => {
                const Glyph = SOCIAL_GLYPHS[t.network];
                return canFollow ? (
                  <FollowButton key={t.network} target={t} Glyph={Glyph} pending={pending} onAct={(network, next) => act("follow", () => recordFollow(item.id, network, next), startVisit)} />
                ) : (
                  <span
                    key={t.network}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold",
                      t.followed ? "border-foreground bg-foreground text-background" : "border-dashed bg-transparent text-muted-foreground",
                    )}
                    aria-label={`${t.label}: ${t.followed ? "following" : "not following"}`}
                  >
                    <Glyph />
                    {t.label}
                    {t.followed && <Check className="size-3.5" aria-hidden />}
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{canFollow ? "The weakest signal; no college says it counts this." : "The student's to tap, from their own account."}</p>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {canEdit && (
        <div className="mt-3">
          <button type="button" disabled={busy || busyInfo || pending} onClick={() => onSkip(task)} className={SECONDARY}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

function FollowButton({
  target,
  Glyph,
  pending,
  onAct,
}: {
  target: ReturnType<typeof followTargets>[number];
  Glyph: () => ReactNode;
  pending: boolean;
  onAct: (network: SocialNetwork, next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={target.followed}
      disabled={pending}
      onClick={() => onAct(target.network, !target.followed)}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold disabled:opacity-60",
        target.followed ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      <Glyph />
      {target.label}
      {target.followed && <Check className="size-3.5" aria-hidden />}
    </button>
  );
}

export default InterestCard;
