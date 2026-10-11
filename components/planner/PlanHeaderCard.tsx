import Link from "next/link";
import { Pencil } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { TEST_LABEL } from "@/lib/planner/standing";
import { planHref } from "@/lib/planner/plan-tabs";
import { gpaAsEntered } from "@/lib/student-profile";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

/**
 * The header (specs/planner/redesign/page.md "The page"): "Your plan" or "Maya's plan", and the numbers as one
 * line that opens the intake guide in edit mode (specs/planner/redesign/intake.md "Edit mode", `?setup=1`). On a
 * phone the numbers sit right of the title; on desktop they're below it, after the class year and season. No
 * completeness meter, no courses button (the intake and the Scores tab cover courses and numbers now), no inline
 * numbers form. A parent with edit access gets the same ✎; a read-only viewer with no numbers yet sees "No numbers
 * yet" instead, with no edit affordance.
 */
export function PlanHeaderCard({
  ctx,
  view,
  relation,
  firstName,
  season,
}: {
  ctx: PlanContext;
  view: PlanView;
  relation: "self" | "guardian";
  firstName: string | null;
  season: string;
}) {
  const title = relation === "self" ? "Your plan" : `${firstName ?? "Their"}'s plan`;
  const gradYear = ctx.student?.grad_year ?? null;
  // The GPA as entered ("4.4 weighted"), not the unweighted conversion the rules read.
  const enteredGpa = ctx.profile ? gpaAsEntered(ctx.profile.academics) : null;
  const gpaText = enteredGpa ?? (view.student.gpa !== null ? view.student.gpa.toFixed(2) : null);
  const testText = view.student.test ? `${TEST_LABEL[view.student.test.kind]} ${view.student.test.score}` : null;
  const numbersText = !gpaText && !testText ? "No numbers yet" : `${gpaText ? `GPA ${gpaText}` : "No GPA yet"} · ${testText ?? "Not testing"}`;
  const href = planHref({ person: relation === "self" ? null : (ctx.student?.id ?? null), setup: true });
  const canEdit = ctx.viewer.canEdit;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-[26px] leading-tight font-extrabold tracking-[-0.025em] lg:text-[36px]">
          <Term term="plan">{title}</Term>
        </h1>
        {canEdit ? (
          <Link
            href={href}
            className="flex min-h-11 shrink-0 items-center gap-1.5 self-center text-sm font-semibold text-muted-foreground hover:text-foreground lg:hidden"
          >
            {numbersText}
            <Pencil className="size-3.5 shrink-0" aria-hidden />
          </Link>
        ) : (
          <p className="shrink-0 self-center text-sm text-muted-foreground lg:hidden">{numbersText}</p>
        )}
      </div>
      <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
        {gradYear ? `Class of ${gradYear} · ` : ""}
        {season}
        {" · "}
        {canEdit ? (
          <Link href={href} className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:underline">
            {numbersText}
            <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ) : (
          numbersText
        )}
      </p>
    </div>
  );
}
