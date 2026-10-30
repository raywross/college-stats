/**
 * The Essays tab (specs/product/essays/tab.md "The screen"): what to write, for whom, by when, and where each one
 * stands. The header line from `essayProgress` ("14 of 23 ready · next: Duke, Nov 1"), the personal essay's card
 * first when a college takes the Common App, then one card per college in the plan's deadline order (the essays
 * move's order), then folds for the Coalition's prompts and drafts not tied to a college. A guardian sees the same
 * screen read-only with the lead line "Only {first} edits a draft; you can read and comment." No essay text: titles,
 * counts, and statuses only. Server component; the cards are client components (Start, the picker).
 *
 * The drafts come from the tab's own read (`essays`, lib/essays/tab-data.ts, read by app/advisor/page.tsx only when
 * this tab is open), else from the plan's `ctx.essays` when that carries them.
 */
import Link from "next/link";
import { CollegeEssayCard, MainEssayCard, PromptRow } from "@/components/essays/CollegeEssayCard";
import { EssayList } from "@/components/essays/EssayList";
import { PromptPicker } from "@/components/essays/PromptPicker";
import { essayProgress, progressLine, type PromptProgress } from "@/lib/essays/progress";
import { groupEssays, isMainEssay, refsOf } from "@/lib/essays/rows";
import { collegesByEssay, type EssaysTabData } from "@/lib/essays/tab-view";
import { planHref } from "@/lib/planner/plan-tabs";
import type { PlanContext } from "@/lib/planner/types";

const CARD = "rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6";
/** Seasons whose student writes the personal essay even before a college is on the list (tab.md "Empty list"). */
const ESSAY_SEASONS = new Set(["summer_before_senior", "senior_fall", "senior_winter", "senior_spring"]);

export function EssaysTab({ ctx, essays, person, canWrite }: { ctx: PlanContext; essays: EssaysTabData | null; person: string | null; canWrite: boolean }) {
  const first = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const header = (line: string | null) => (
    <header className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="essays-title" className="font-display text-2xl font-bold">
          Your essays
        </h2>
        {line && (
          <p className="text-sm font-semibold text-muted-foreground" data-progress-line>
            {line}
          </p>
        )}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground" data-lead>
        {canWrite ? "Write the personal essay once; each college's own prompts below, earliest deadline first." : `Only ${first ?? "the student"} edits a draft; you can read and comment.`}
      </p>
      {canWrite && essays?.kind === "ready" && (
        <div className="pt-1">
          <PromptPicker groups={essays.picker} person={person} />
        </div>
      )}
    </header>
  );

  if (essays?.kind === "setup-missing") {
    return (
      <section aria-labelledby="essays-title" className="space-y-5">
        {header(null)}
        <p className={CARD}>The essay workspace isn&apos;t set up in the database yet.</p>
      </section>
    );
  }

  const rows = essays?.rows ?? ctx.essays?.rows ?? [];
  const links = essays?.links ?? ctx.essays?.links ?? [];
  const openComments = essays?.openComments ?? {};
  const picker = essays?.picker ?? [];
  const progress = essayProgress({ items: ctx.items, schools: ctx.schools, essays: { rows, links } });
  const names: Record<string, string> = { ...(essays?.collegeNames ?? {}) };
  for (const c of progress.colleges) names[c.unit_id] = c.name;
  const byEssay = collegesByEssay(rows, links, names);

  // The prompts' own words by ref (the college's, from the plan's school records), for a vague kind's first words.
  const texts: Record<string, string> = {};
  for (const s of Object.values(ctx.schools)) for (const p of s.essays?.prompts ?? []) texts[`college:${p.id}`] = p.text;

  // The personal essay: on every Common App list, and before any college for a student in the writing seasons.
  const mainRow = rows.find((e) => isMainEssay(e, links)) ?? null;
  const main =
    progress.main ??
    (ctx.items.length === 0 && ESSAY_SEASONS.has(ctx.season)
      ? { state: !mainRow ? ("not_started" as const) : mainRow.status === "draft" ? ("draft" as const) : ("ready" as const), essayId: mainRow?.id ?? null, count: mainRow?.count ?? 0, limit: 650 }
      : null);
  const usedBy = progress.colleges.filter((c) => c.takesCommonApp).length;

  // Folds: the Coalition's prompts when a listed college takes it; drafts for no college; drafts for colleges no longer listed.
  const takesCoalition = ctx.items.some((i) => !!ctx.schools[i.unit_id]?.coalition);
  const coalition = picker.find((g) => g.key === "coalition") ?? null;
  const coalitionRows: PromptProgress[] =
    takesCoalition && coalition
      ? coalition.prompts.map((p) => {
          const e = rows.find((r) => refsOf(r, links).includes(p.ref)) ?? null;
          return { ref: p.ref, title: p.title, kind: p.kind, limit: p.limit, state: !e ? "not_started" : e.status === "draft" ? "draft" : "ready", essayId: e?.id ?? null, count: e?.count ?? null };
        })
      : [];
  const onPlan = progress.colleges.map((c) => ({ unit_id: c.unit_id, name: c.name }));
  const groups = groupEssays(rows, links, onPlan, (u) => names[u] ?? null);
  const loose = groups.filter((g) => g.key === "other");
  const listed = new Set(ctx.items.map((i) => i.unit_id));
  const offPlan = groups.filter((g) => g.unitId !== null && !listed.has(g.unitId));
  const looseCount = loose.reduce((n, g) => n + g.essays.length, 0);

  return (
    <section aria-labelledby="essays-title" className="space-y-5" data-essays-tab>
      {header(progressLine(progress))}

      {main && <MainEssayCard main={main} usedBy={usedBy} person={person} canWrite={canWrite} comments={main.essayId ? (openComments[main.essayId] ?? 0) : 0} />}

      {progress.colleges.length === 0 ? (
        <p className={CARD} data-empty>
          Add colleges first; their prompts show up here.{" "}
          <Link href={planHref({ person, tab: "colleges" })} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
            Go to Colleges
          </Link>
        </p>
      ) : (
        <div className="space-y-3">
          {progress.colleges.map((c) => (
            <CollegeEssayCard key={c.unit_id} college={c} texts={texts} byEssay={byEssay} openComments={openComments} person={person} canWrite={canWrite} picker={picker} />
          ))}
        </div>
      )}

      {coalitionRows.length > 0 && (
        <details className="group rounded-3xl border bg-card" data-fold="coalition">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold sm:px-5">Coalition prompts</summary>
          <ul className="divide-y border-t">
            {coalitionRows.map((p) => (
              <PromptRow key={p.ref} p={p} text={null} also={null} comments={p.essayId ? (openComments[p.essayId] ?? 0) : 0} person={person} canWrite={canWrite} />
            ))}
          </ul>
        </details>
      )}
      {looseCount > 0 && (
        <details className="group rounded-3xl border bg-card" data-fold="loose">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold sm:px-5">Not for a college yet ({looseCount})</summary>
          <div className="p-3 sm:p-4">
            <EssayList groups={loose} openComments={openComments} person={person} emptyLine="" />
          </div>
        </details>
      )}
      {offPlan.length > 0 && (
        <details className="group rounded-3xl border bg-card" data-fold="off-plan">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold sm:px-5">Colleges no longer on your list</summary>
          <div className="p-3 sm:p-4">
            <EssayList groups={offPlan} openComments={openComments} person={person} emptyLine="" />
          </div>
        </details>
      )}
    </section>
  );
}

export default EssaysTab;
