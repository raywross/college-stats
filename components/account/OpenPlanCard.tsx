import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";

/**
 * Replaces the household hub's old embedded list board on a student's page (specs/product/household-hub.md
 * "Household cleanup (2026-10-12)"): the planner now owns a student's colleges, levels, rounds, and deadlines
 * (specs/chances/levels.md, specs/planner/redesign/list.md), so this is a plain link into it rather than a second,
 * older copy of the same list. `first` is the student's first name for the "Open {name}'s plan" wording; null reads
 * as "their" for the rare case a record has no name yet.
 */
export function OpenPlanCard({ href, first, own }: { href: string; first: string | null; own: boolean }) {
  const whose = own ? "your" : first ? `${first}'s` : "their";
  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ListChecks className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold sm:text-xl">
            {own ? "Your colleges live in the plan" : `${first ? `${first}'s` : "Their"} colleges live in the plan`}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Colleges, levels, rounds, deadlines, and the calendar are all in {whose}{" "}
            <Link href={href} className="font-semibold text-primary hover:underline">
              plan
            </Link>
            {own ? ". " : " now. "}
            Household still handles the family&apos;s roster, who can edit, and {whose} numbers.
          </p>
        </div>
      </div>
      <Link
        href={href}
        className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Open {whose} plan
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
