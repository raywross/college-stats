import Link from "next/link";
import { Pencil } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { TEST_LABEL } from "@/lib/planner/standing";
import { planHref } from "@/lib/planner/plan-tabs";
import { gpaAsEntered } from "@/lib/student-profile";
import type { PlanContext } from "@/lib/planner/types";
import type { PlanView } from "@/lib/planner/plan-view";

/**
 * The header (specs/planner/redesign/page.md "The page"): "Your plan" for a student, the student's first name for a
 * parent ("Maya", not "Maya's plan": owner, 2026-10-11), and the numbers as a button that opens the intake guide in
 * edit mode (specs/planner/redesign/intake.md "Edit mode", `?setup=1`). The button is bordered with a purple "Edit"
 * chip so it reads as the way to change the numbers (owner: the bare ✎ wasn't prominent enough). On desktop the class
 * year and season sit under the title. A read-only viewer sees the numbers as plain text, or "No numbers yet".
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
  const title = relation === "self" ? <Term term="plan">Your plan</Term> : (firstName ?? "Their plan");
  const gradYear = ctx.student?.grad_year ?? null;
  // The GPA as entered ("4.4 weighted"), not the unweighted conversion the rules read.
  const enteredGpa = ctx.profile ? gpaAsEntered(ctx.profile.academics) : null;
  const gpaText = enteredGpa ?? (view.student.gpa !== null ? view.student.gpa.toFixed(2) : null);
  const testText = view.student.test ? `${TEST_LABEL[view.student.test.kind]} ${view.student.test.score}` : null;
  const numbersText = !gpaText && !testText ? "No numbers yet" : `${gpaText ? `GPA ${gpaText}` : "No GPA yet"} · ${testText ?? "Not testing"}`;
  const href = planHref({ person: relation === "self" ? null : (ctx.student?.id ?? null), setup: true });
  const whose = relation === "self" ? "your" : firstName ? `${firstName}'s` : "their";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="font-display text-[26px] leading-tight font-extrabold tracking-[-0.025em] lg:text-[36px]">{title}</h1>
        {ctx.viewer.canEdit ? (
          <Link
            href={href}
            aria-label={`Edit ${whose} grades, test, and AP courses (${numbersText})`}
            className="inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-full border bg-card py-1 pr-1 pl-4 text-sm font-semibold shadow-sm transition-colors hover:border-foreground/40"
          >
            <span className="min-w-0 truncate">{numbersText}</span>
            <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-primary-foreground">
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </span>
          </Link>
        ) : (
          <p className="text-sm font-semibold text-muted-foreground">{numbersText}</p>
        )}
      </div>
      <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
        {gradYear ? `Class of ${gradYear} · ` : ""}
        {season}
      </p>
    </div>
  );
}
