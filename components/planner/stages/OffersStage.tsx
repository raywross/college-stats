import Link from "next/link";
import { FileText, PartyPopper } from "lucide-react";
import { StagePanel } from "@/components/planner/StagePanel";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { TaskRow } from "@/components/planner/TaskRow";
import { ChooseButton } from "@/components/planner/ChooseButton";
import { OffersTable, type OfferColumn } from "@/components/planner/OffersTable";
import { OutcomeChip, OutcomePicker, shortDate } from "@/components/planner/OutcomePicker";
import { CopyText, OutcomeShareConsent, ProsCons, WithdrawButton } from "@/components/planner/OfferControls";
import { LetterList, type SharedLetter } from "@/components/planner/ShareLetter";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { CATEGORY_LABELS } from "@/lib/list-rules";
import { compareHref } from "@/lib/compare-routes";
import { createServerSupabase } from "@/lib/supabase-server";
import { chosenItem, isEdChoice, isPending } from "@/lib/planner/generators/offers";
import { appealSummary, questionsToAsk, usd, waitListLine, waitListOdds } from "@/lib/planner/offers";
import { offerColumns, offerFacts, waitListFacts } from "@/lib/planner/offers-server";
import type { PlanContext, PlanTask, TaskKind } from "@/lib/planner/types";

const cited = (c: unknown) => (c ?? undefined) as AnyCited | undefined;

/** After-the-choice steps, in the order the panel lists them. */
const CHOICE_KINDS: readonly TaskKind[] = ["reply_by", "deposit", "housing_deposit", "withdraw", "waitlist_decide"];

/** Splits ids into chunks of four (the compare pages take at most four). */
function fours(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += 4) out.push(ids.slice(i, i + 4));
  return out;
}

/**
 * Stage 6, decisions, offers, and the choice (specs/planner/offers.md "Display"). A server component: it reads the
 * admitted colleges' cost facts and history (lib/planner/offers-server.ts), the wait-listed colleges' C2 history, the
 * shared letters, and the outcome-share flag with the viewer's own session, then renders
 *
 *   the decisions row (each college's outcome and date; before any, "Decisions start arriving {date}", cited)
 *   wait lists with their history (cited)
 *   the offers table (OffersTable: side by side, sortable, the four-year slope) and, per college, questions to ask,
 *     the appeal line, shared letters, pros and cons
 *   Compare my admits (the site's compare pages)
 *   the choice ("I'm going to {College}"), then the household card, the after-the-choice steps, the summer list, and
 *     the opt-in to share where the student went.
 */
export default async function OffersStage({ ctx }: { ctx: PlanContext }) {
  const supabase = await createServerSupabase();
  const studentFirst = ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null;
  const self = ctx.viewer.relation === "self";
  const nameOf = (unitId: string) => ctx.schools[unitId]?.name ?? "A college";

  const admitted = ctx.items.filter((i) => i.outcome === "admitted");
  const waitlisted = ctx.items.filter((i) => i.outcome === "waitlisted" && !i.withdrawn_on);
  const inPlay = ctx.items.filter((i) => i.status !== "considering");
  const anyDecided = ctx.items.some((i) => i.status === "decided" || i.decision_date !== null);
  const chosen = chosenItem(ctx.items);

  const [facts, waits, letterRows, consentRow] = await Promise.all([
    offerFacts(admitted.map((i) => i.unit_id), ctx.profile),
    waitListFacts(waitlisted.map((i) => i.unit_id)),
    ctx.items.length
      ? supabase.from("plan_letters").select("id, item_id, kind, uploaded_by, created_at").in("item_id", ctx.items.map((i) => i.id)).order("created_at")
      : Promise.resolve({ data: [] }),
    supabase.from("lists").select("outcome_share_consented_at").eq("id", ctx.list.id).maybeSingle(),
  ]);
  const letters = ((letterRows.data ?? []) as { id: string; item_id: string; kind: SharedLetter["kind"]; uploaded_by: string; created_at: string }[]).map((l) => ({
    ...l,
    mine: l.uploaded_by === ctx.viewer.userId,
  }));
  // The column arrives with this unit's migration; until it's applied, the opt-in is hidden rather than broken.
  const consentReady = !consentRow.error;
  const consented = Boolean((consentRow.data as { outcome_share_consented_at: string | null } | null)?.outcome_share_consented_at);

  const columns = offerColumns(ctx, facts);
  const awardYear = ctx.cycle.startYear + 1;
  const tableColumns: OfferColumn[] = columns.map((c) => ({
    itemId: c.item.id,
    unitId: c.item.unit_id,
    school: { unit_id: c.school.unit_id, name: c.school.name, brand: c.school.brand },
    position: c.item.position,
    dream: c.item.dream,
    offerId: c.offer?.id ?? null,
    awardYear,
    draft: c.draft,
    view: c.view,
    four: c.four,
    facts: c.facts,
    distanceMiles: c.school.distanceMiles,
    visitRating: c.visitRating,
    canEdit: ctx.viewer.canEdit,
  }));
  const fallbacks = Object.fromEntries(columns.map((c) => [c.item.unit_id, c.facts?.fullPrice ?? null]));
  const budget = ctx.profile?.preferences.maxAverageCost ?? null;

  // Decisions expected: each pending college's decision_expected task (its date carries the college's own citation).
  const expected = ctx.items
    .filter((i) => isPending(i) && !i.withdrawn_on)
    .map((i) => ({ item: i, task: ctx.tasks.find((t) => t.item_id === i.id && t.kind === "decision_expected" && !t.orphaned && t.due_on) ?? null }))
    .filter((e): e is { item: (typeof e)["item"]; task: PlanTask } => e.task !== null)
    .sort((a, b) => a.task.due_on!.localeCompare(b.task.due_on!));
  const cite = (t: PlanTask) => {
    const item = ctx.items.find((i) => i.id === t.item_id);
    const s = item ? ctx.schools[item.unit_id] : null;
    return t.source_field && s ? s.cites[t.source_field] : undefined;
  };

  const admittedIds = admitted.filter((i) => !i.withdrawn_on).map((i) => i.unit_id);
  const compareGroups = fours(admittedIds);

  const choiceTasks = chosen
    ? ctx.tasks
        .filter((t) => CHOICE_KINDS.includes(t.kind) && !t.dismissed && !t.orphaned && (t.kind === "withdraw" || t.kind === "waitlist_decide" || t.item_id === chosen.id))
        .sort((a, b) => CHOICE_KINDS.indexOf(a.kind) - CHOICE_KINDS.indexOf(b.kind) || (a.due_on ?? "9").localeCompare(b.due_on ?? "9"))
    : [];
  const summer = chosen ? ctx.tasks.filter((t) => t.kind === "summer" && !t.dismissed && !t.orphaned) : [];
  const othersOpen = (itemId: string) => ctx.items.filter((i) => i.id !== itemId && !i.withdrawn_on && (isPending(i) || i.outcome === "admitted" || i.outcome === "waitlisted")).length;
  const canConsent = self || (ctx.student?.user_id == null && ctx.viewer.canEdit && ctx.viewer.isGuardian);

  const taskRow = (t: PlanTask, children?: React.ReactNode) => {
    const item = t.item_id ? ctx.items.find((i) => i.id === t.item_id) : null;
    const school = item ? (ctx.schools[item.unit_id] ?? null) : null;
    return (
      <TaskRow key={t.id} task={t} school={school} cited={cite(t)} canEdit={ctx.viewer.canEdit} today={ctx.today} viewer={ctx.viewer} studentFirstName={studentFirst}>
        {children}
      </TaskRow>
    );
  };

  return (
    <StagePanel
      stage={6}
      ctx={ctx}
      actions={
        ctx.student ? (
          <Link href={`/household/${ctx.student.id}/plan/print`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:min-h-10 print:hidden">
            <FileText className="size-4" aria-hidden /> Family dossier
          </Link>
        ) : null
      }
    >
      {/* Decisions */}
      <section aria-labelledby="offers-decisions" className="space-y-2">
        <h3 id="offers-decisions" className="font-display text-lg font-bold">
          Decisions
        </h3>
        {!anyDecided && (
          <div className="text-sm">
            {expected.length ? (
              <>
                <p>
                  Decisions start arriving <strong>{shortDate(expected[0].task.due_on!)}</strong>.
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {expected.map(({ item, task }) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-1.5">
                      <span>{nameOf(item.unit_id)}:</span>
                      <MetricLabel cited={cited(cite(task))}>
                        <span>{shortDate(task.due_on!)}</span>
                      </MetricLabel>
                      {task.date_note === "last_cycle" && <span className="text-xs">(last year&apos;s date; confirm on the college&apos;s page)</span>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">
                {inPlay.length ? "None of your colleges publishes a decision date for your round. Record each decision here when it comes." : "Decisions come after applying. Colleges you apply to show up here."}
              </p>
            )}
          </div>
        )}
        {inPlay.length > 0 && (
          <ul className="divide-y rounded-2xl border">
            {inPlay.map((item) => (
              <li key={item.id} className="space-y-1.5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CollegeChip school={ctx.schools[item.unit_id] ?? null} link />
                  {item.withdrawn_on ? (
                    <span className="text-xs text-muted-foreground">Withdrawn {shortDate(item.withdrawn_on)}</span>
                  ) : item.outcome ? (
                    <OutcomeChip outcome={item.outcome} date={item.decision_date} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{item.status === "applied" ? (item.decision_date ? `Deferred ${shortDate(item.decision_date)}: waiting` : "Waiting") : "Applying"}</span>
                  )}
                </div>
                {ctx.viewer.canEdit && !item.withdrawn_on && (
                  <details className="group" open={!item.outcome && item.status === "applied" && !item.decision_date && expected.some((e) => e.item.id === item.id && e.task.due_on! <= ctx.today)}>
                    <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-primary sm:min-h-8">
                      {item.outcome ? "Change what they said" : "Record what they said"}
                    </summary>
                    <OutcomePicker itemId={item.id} outcome={item.outcome} decisionDate={item.decision_date} today={ctx.today} canEdit collegeName={nameOf(item.unit_id)} compact />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Wait lists */}
      {waitlisted.length > 0 && (
        <section aria-labelledby="offers-waitlists" className="space-y-2">
          <h3 id="offers-waitlists" className="font-display text-lg font-bold">
            <Term term="wait-list">Wait lists</Term>
          </h3>
          <ul className="space-y-2">
            {waitlisted.map((item) => {
              const w = waits[item.unit_id] ?? null;
              const line = waitListLine(w);
              const odds = waitListOdds(w);
              return (
                <li key={item.id} className="rounded-2xl border p-3 text-sm">
                  <CollegeChip school={ctx.schools[item.unit_id] ?? null} link />
                  {line ? (
                    <p className="mt-1">
                      <MetricLabel cited={cited(w?.cites.admitted ?? w?.cites.offered ?? w?.cites.accepted)}>
                        <span>
                          Last reported: {line}
                          {odds !== null ? ` (about ${Math.max(1, Math.round(odds * 100))} in 100 who stayed on got in)` : ""}.
                        </span>
                      </MetricLabel>
                    </p>
                  ) : (
                    <p className="mt-1 text-muted-foreground">The college doesn&apos;t publish how many it admits from its wait list.</p>
                  )}
                  <p className="mt-1 text-muted-foreground">A wait list isn&apos;t an offer: deposit somewhere else by May 1 to keep a place.</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Offers */}
      {columns.length > 0 && (
        <section aria-labelledby="offers-table" className="space-y-3">
          <h3 id="offers-table" className="font-display text-lg font-bold">
            Offers side by side
          </h3>
          <p className="text-sm text-muted-foreground">
            Each offer in the federal College Financing Plan&apos;s order: <Term term="cost-of-attendance">cost</Term>, <Term term="gift-aid">gift aid</Term>,{" "}
            <Term term="net-cost">net cost</Term>, then loans, which are repaid. Nothing here is ranked.
          </p>
          <OffersTable columns={tableColumns} fallbacks={fallbacks} />

          <div className="space-y-2">
            {columns.map((c) => {
              const others = columns.filter((o) => o.item.id !== c.item.id && o.view).map((o) => ({ name: o.school.name, view: o.view! }));
              const appeal = c.view ? appealSummary({ name: c.school.name, view: c.view, awardYear: c.offer!.award_year }, others, budget) : null;
              const questions = questionsToAsk(c.flags);
              const visits = ctx.visits.filter((v) => v.item_id === c.item.id && (v.notes.stood_out || v.notes.worried));
              return (
                <details key={c.item.id} className="rounded-2xl border p-3">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <CollegeChip school={c.school} />
                    <span className="text-xs text-muted-foreground">
                      {c.view ? `${questions.length} question${questions.length === 1 ? "" : "s"} to ask` : "No offer yet"} · pros and cons
                    </span>
                  </summary>
                  <div className="mt-2 space-y-3 text-sm">
                    <ul className="space-y-0.5 text-muted-foreground">
                      <li>
                        Your category: {CATEGORY_LABELS[c.item.category]}
                        {c.item.dream ? " · your Dream" : ""}
                      </li>
                      {c.visitRating !== null && <li>Visit rating: {c.visitRating} of 5</li>}
                      {visits.map((v) => (
                        <li key={v.id}>
                          Visit notes: {[v.notes.stood_out && `stood out: ${v.notes.stood_out}`, v.notes.worried && `worried: ${v.notes.worried}`].filter(Boolean).join("; ")}
                        </li>
                      ))}
                      {budget !== null && c.view?.netCost != null && (
                        <li>
                          Net cost is {usd(Math.abs(c.view.netCost - budget))} {c.view.netCost > budget ? "over" : "under"} the {usd(budget)} a year in the profile.
                        </li>
                      )}
                      {c.facts?.trend && (
                        <li>
                          Costs grow at the college&apos;s own rate from {c.facts.trend.from} to {c.facts.trend.to}
                          {c.facts.trend.tuition !== null ? `: tuition ${(c.facts.trend.tuition * 100).toFixed(1)}% a year` : ""}
                          {c.facts.trend.housing !== null ? `, housing ${(c.facts.trend.housing * 100).toFixed(1)}%` : ""} (not adjusted for inflation; source:{" "}
                          {c.facts.trendSources.map((s, i) => (
                            <span key={s.label}>
                              {i > 0 ? "; " : ""}
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                                {s.label}, {s.years}
                              </a>
                            </span>
                          ))}
                          ).
                        </li>
                      )}
                      {c.view && !c.facts?.trend && <li>No cost history for this college, so the four years hold its costs level.</li>}
                    </ul>
                    {c.flags.length > 0 && (
                      <ul className="space-y-1">
                        {c.flags.map((f, i) => (
                          <li key={`${f.key}-${i}`} className={f.severity === "trap" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
                            {f.line}
                          </li>
                        ))}
                      </ul>
                    )}
                    {questions.length > 0 && (
                      <div>
                        <p className="font-semibold">Questions to ask {c.school.name}&apos;s aid office</p>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                          {questions.map((q) => (
                            <li key={q}>{q}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {appeal && (
                      <div className="space-y-1.5 rounded-xl bg-muted/40 p-3">
                        <p className="font-semibold">If you ask {c.school.name} to look again</p>
                        <p className="text-muted-foreground">{appeal}</p>
                        <CopyText text={appeal} label="Copy the summary" />
                      </div>
                    )}
                    <LetterList letters={letters.filter((l) => l.item_id === c.item.id)} />
                    <div>
                      <p className="mb-1 font-semibold">Pros and cons</p>
                      <ProsCons itemId={c.item.id} collegeName={c.school.name} pros={c.notes.pros} cons={c.notes.cons} canEdit={ctx.viewer.canEdit} />
                    </div>
                  </div>
                </details>
              );
            })}
          </div>

          {admittedIds.length >= 2 && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={compareHref(compareGroups[0])} className="inline-flex min-h-11 items-center rounded-full border px-4 font-semibold hover:bg-muted sm:min-h-9">
                Compare my admits
              </Link>
              {compareGroups.slice(1).map((g) => (
                <Link key={g.join(",")} href={compareHref(g, "table")} className="inline-flex min-h-11 items-center rounded-full border px-4 font-semibold hover:bg-muted sm:min-h-9">
                  All the numbers: {g.map(nameOf).join(", ")}
                </Link>
              ))}
              <span className="text-xs text-muted-foreground">The site&apos;s compare pages, for the colleges themselves.</span>
            </p>
          )}
        </section>
      )}

      {/* The choice */}
      {admitted.length > 0 && !chosen && (
        <section aria-labelledby="offers-choice" className="space-y-2">
          <h3 id="offers-choice" className="font-display text-lg font-bold">
            The choice
          </h3>
          <p className="text-sm text-muted-foreground">When {self ? "you know" : `${studentFirst ?? "they"} know${studentFirst ? "s" : ""}`}, say so here: the plan turns to the deposit, the other colleges, and the summer.</p>
          <div className="flex flex-wrap gap-2">
            {admitted
              .filter((i) => !i.withdrawn_on)
              .map((i) => (
                <ChooseButton key={i.id} itemId={i.id} unitId={i.unit_id} collegeName={nameOf(i.unit_id)} ed={isEdChoice(i)} others={othersOpen(i.id)} canEdit={ctx.viewer.canEdit} />
              ))}
          </div>
        </section>
      )}

      {chosen && (
        <section aria-labelledby="offers-chosen" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <PartyPopper className="size-6 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                <h3 id="offers-chosen" className="font-display text-lg font-bold">
                  {self ? "You chose" : `${studentFirst ?? "They"} chose`} {nameOf(chosen.unit_id)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Decided {chosen.committed_on ? shortDate(chosen.committed_on) : ""}. The household sees this card; a share image with the crest and class year comes later.
                </p>
              </div>
            </div>
            <ChooseButton itemId={chosen.id} unitId={chosen.unit_id} collegeName={nameOf(chosen.unit_id)} ed={false} others={0} chosen canEdit={ctx.viewer.canEdit} />
          </div>
          {isEdChoice(chosen) && <p className="text-sm font-semibold">Early decision is binding: every other application comes out now.</p>}
          {choiceTasks.length > 0 && (
            <ul className="divide-y">
              {choiceTasks.map((t) => {
                const item = t.item_id ? ctx.items.find((i) => i.id === t.item_id) : null;
                return taskRow(
                  t,
                  (t.kind === "withdraw" || t.kind === "waitlist_decide") && item && ctx.viewer.canEdit ? (
                    <WithdrawButton itemId={item.id} collegeName={nameOf(item.unit_id)} withdrawnOn={item.withdrawn_on} />
                  ) : undefined,
                );
              })}
            </ul>
          )}
          {summer.length > 0 && (
            <div>
              <h4 className="font-semibold">
                The summer list{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (it keeps <Term term="summer-melt">summer melt</Term> away)
                </span>
              </h4>
              <ul className="divide-y">{summer.map((t) => taskRow(t))}</ul>
            </div>
          )}
          {consentReady && (
            <OutcomeShareConsent listId={ctx.list.id} consented={consented} canChange={canConsent} studentName={self ? null : studentFirst} />
          )}
        </section>
      )}
    </StagePanel>
  );
}
