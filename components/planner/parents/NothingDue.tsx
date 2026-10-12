import { Check } from "lucide-react";

/**
 * The Next up card's empty state (specs/planner/redesign/page.md "The page"; screens 3b/3c): a lime check tile,
 * "Nothing due this year", shown in Next up's slot whenever the list has no open deadline — a student with nothing
 * due yet, or (most often) a parent looking at a younger child who hasn't picked rounds. On a phone the subtitle is
 * the same season words as the header card ("Class of 2029 · building the list"); on desktop, where this sits in
 * the aside instead of beside the title, it explains why instead ("Deadlines show up here once Sam picks rounds.").
 */
export function NothingDue({
  gradYear,
  season,
  relation,
  firstName,
}: {
  gradYear: number | null;
  season: string;
  relation: "self" | "guardian";
  firstName: string | null;
}) {
  const aboutWho = relation === "self" ? "you pick" : firstName ? `${firstName} picks` : "they pick";
  return (
    <div className="flex min-w-60 items-start gap-3 rounded-3xl border bg-card p-5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-pop text-pop-foreground" aria-hidden>
        <Check className="size-6" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <p className="font-display text-lg leading-tight font-bold">Nothing due this year</p>
        <p className="mt-0.5 text-sm text-muted-foreground lg:hidden">
          {gradYear ? `Class of ${gradYear} · ` : ""}
          {season}
        </p>
        <p className="mt-0.5 hidden text-sm text-muted-foreground lg:block">Deadlines show up here once {aboutWho} rounds.</p>
      </div>
    </div>
  );
}
