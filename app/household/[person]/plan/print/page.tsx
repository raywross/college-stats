import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AuthUnavailable } from "@/components/account/AuthUnavailable";
import { PrintButton } from "@/components/planner/PrintButton";
import { MetricLabel } from "@/components/ui/info-tip";
import { AccountsSetupError, authConfigured, requireUser } from "@/lib/auth";
import { personPage, scheduleStudentReadLog } from "@/lib/households";
import { myHome } from "@/lib/home-store";
import { myLists } from "@/lib/lists";
import { createServerSupabase } from "@/lib/supabase-server";
import { profileFor } from "@/lib/student-profile-store";
import { effectiveGradYear } from "@/lib/student-profile";
import { CATEGORY_LABELS, LIST_CATEGORIES, OUTCOME_LABELS, ROUND_LABELS, STATUS_LABELS } from "@/lib/list-rules";
import type { AnyCited } from "@/lib/lineage";
import { generatorInputFor, PlannerSetupError, readPlan, todayIso } from "@/lib/planner/context";
import { VISIT_KIND_LABELS, VISIT_NOTE_PROMPTS } from "@/lib/planner/actions";
import { LOANS, awardYearLabel, isEnteredOffer, ratesFor, usd } from "@/lib/planner/offers";
import { offerColumns, offerFacts } from "@/lib/planner/offers-server";

export const metadata: Metadata = { title: "Family dossier", robots: { index: false } };

const cited = (c: unknown) => (c ?? undefined) as AnyCited | undefined;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * /household/[person]/plan/print: the family dossier (specs/planner/offers.md "Display"; the build's owner assumption:
 * a print view, not a PDF library). One page with the list by category, the rounds plan, visits and their notes, the
 * offers side by side with four-year totals, and a sources line. The browser's print dialog saves it as a PDF; on
 * screen it reads as a page with a "Print or save as PDF" button. Read with the viewer's own session (a guardian's
 * read is logged for the student, as the Plan tab's is). Students only, like the Plan tab.
 */
export default async function DossierPage({ params }: { params: Promise<{ person: string }> }) {
  await connection();
  if (!authConfigured()) return <AuthUnavailable />;
  const { person: id } = await params;
  await requireUser(`/household/${id}/plan/print`);

  let person;
  try {
    person = await personPage(id);
  } catch (err) {
    if (err instanceof AccountsSetupError) return <AuthUnavailable title="Accounts aren't set up yet" />;
    throw err;
  }
  if (person?.kind !== "student") {
    if (person) redirect(`/household/${id}`);
    notFound();
  }
  const { student, relation } = person.access;
  const first = student.display_name?.trim().split(/\s+/)[0] || null;
  const lists = await myLists({ kind: "student", id: student.id });
  const listId = lists.find((l) => l.is_default)?.id ?? lists[0]?.id ?? null;
  const back = (
    <Link href={`/household/${id}/plan`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground print:hidden">
      <ArrowLeft className="size-4" aria-hidden /> Back to the plan
    </Link>
  );
  if (!listId) {
    return (
      <div className="space-y-3">
        {back}
        <p className="text-sm text-muted-foreground">No list yet, so there&apos;s nothing to print.</p>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  if (relation === "guardian") await scheduleStudentReadLog(student.id, "plan_tasks");
  let plan;
  try {
    plan = await readPlan(supabase, listId);
  } catch (err) {
    if (err instanceof PlannerSetupError) return <p className="text-sm text-muted-foreground">The plan isn&apos;t set up yet.</p>;
    throw err;
  }
  if (!plan) notFound();
  const [profile, home] = await Promise.all([profileFor(student.id), myHome()]);
  const today = todayIso();
  const gradYear = profile ? effectiveGradYear(profile.data.basics, student.grad_year) : student.grad_year;
  const input = await generatorInputFor(plan, { gradYear, profile: profile?.data ?? null, home, today });
  const admitted = plan.items.filter((i) => i.outcome === "admitted");
  const facts = await offerFacts(admitted.map((i) => i.unit_id), profile?.data ?? null);
  const columns = offerColumns({ items: plan.items, schools: input.schools, offers: plan.offers, visits: plan.visits }, facts).filter((c) => c.offer && isEnteredOffer(c.offer));
  const name = (unitId: string) => input.schools[unitId]?.name ?? "A college";

  // Sources: every cited figure on the page, once each, with its year; the cost history; the loan figures.
  const cites = [
    ...plan.items.flatMap((i) => [input.schools[i.unit_id]?.admitRateCite, input.schools[i.unit_id]?.avgCostCite]),
    ...Object.values(facts).flatMap((f) => [f.fullPriceCite, f.earningsCite, f.debtCite, f.gradRateCite, f.generosity?.cite]),
  ].filter(Boolean) as AnyCited[];
  const sources = [...new Map(cites.map((c) => [`${c.label}|${c.year ?? ""}`, c])).values()];
  const history = [...new Map(Object.values(facts).flatMap((f) => f.trendSources).map((s) => [`${s.label}|${s.years}`, s])).values()];
  const rateYears = [...new Set(columns.map((c) => ratesFor(c.offer!.award_year)?.award_year).filter((y): y is number => y !== undefined))];

  return (
    <div className="space-y-4">
      {/* Print only the dossier, not the hub around it. */}
      <style>{`@media print { body * { visibility: hidden !important; } #dossier, #dossier * { visibility: visible !important; } #dossier { position: absolute; inset: 0 auto auto 0; width: 100%; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {back}
        <PrintButton />
      </div>
      <article id="dossier" className="space-y-6 rounded-3xl border bg-card p-4 text-sm sm:p-6 print:rounded-none print:border-0 print:p-0">
        <header>
          <h1 className="font-display text-2xl font-bold">{first ? `${first}'s` : "The"} college plan</h1>
          <p className="text-muted-foreground">
            Family dossier · {gradYear ? `Class of ${gradYear} · ` : ""}printed {today}
          </p>
        </header>

        <section className="space-y-2 break-inside-avoid-page">
          <h2 className="font-display text-lg font-bold">The list</h2>
          {LIST_CATEGORIES.map((cat) => {
            const items = plan.items.filter((i) => i.category === cat);
            if (!items.length) return null;
            return (
              <div key={cat}>
                <h3 className="font-semibold">
                  {CATEGORY_LABELS[cat]} ({items.length})
                </h3>
                <ul className="mt-1 space-y-0.5">
                  {items.map((i) => {
                    const s = input.schools[i.unit_id];
                    return (
                      <li key={i.id} className="flex flex-wrap gap-x-2">
                        <span className="font-semibold">
                          {name(i.unit_id)}
                          {i.dream ? " ★ Dream" : ""}
                        </span>
                        <span className="text-muted-foreground">
                          {i.outcome ? OUTCOME_LABELS[i.outcome] : STATUS_LABELS[i.status]}
                          {i.enrolling ? " · going" : ""}
                          {i.withdrawn_on ? " · withdrawn" : ""}
                        </span>
                        {s?.admitRate != null && (
                          <MetricLabel cited={cited(s.admitRateCite)} className="text-muted-foreground">
                            <span>admits {pct(s.admitRate)}</span>
                          </MetricLabel>
                        )}
                        {s?.avgCost != null && (
                          <MetricLabel cited={cited(s.avgCostCite)} className="text-muted-foreground">
                            <span>average cost {usd(s.avgCost)}</span>
                          </MetricLabel>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>

        <section className="space-y-2 break-inside-avoid-page">
          <h2 className="font-display text-lg font-bold">The rounds plan</h2>
          {plan.list.rounds_plan_accepted_at && <p className="text-muted-foreground">Accepted {plan.list.rounds_plan_accepted_at.slice(0, 10)}.</p>}
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2">Priority</th>
                <th className="py-1 pr-2">College</th>
                <th className="py-1">Round</th>
              </tr>
            </thead>
            <tbody>
              {[...plan.items]
                .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || a.position - b.position)
                .map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="py-1 pr-2 tabular-nums">{i.priority ?? "—"}</td>
                    <td className="py-1 pr-2">{name(i.unit_id)}</td>
                    <td className="py-1">{i.round ? ROUND_LABELS[i.round] : "Not set"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">Visits and notes</h2>
          {plan.visits.length === 0 ? (
            <p className="text-muted-foreground">No visits logged.</p>
          ) : (
            <ul className="space-y-2">
              {plan.visits.map((v) => {
                const item = plan.items.find((i) => i.id === v.item_id);
                return (
                  <li key={v.id} className="break-inside-avoid">
                    <p className="font-semibold">
                      {item ? name(item.unit_id) : "A college"}: {VISIT_KIND_LABELS[v.kind]}, {v.on_date}
                      {v.rating !== null ? ` · rated ${v.rating} of 5` : ""}
                    </p>
                    <ul className="text-muted-foreground">
                      {VISIT_NOTE_PROMPTS.filter((p) => v.notes[p.key]?.trim()).map((p) => (
                        <li key={p.key}>
                          {p.label}: {v.notes[p.key]}
                        </li>
                      ))}
                      {v.notes.free?.trim() && <li>{v.notes.free}</li>}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">Offers side by side</h2>
          {columns.length === 0 ? (
            <p className="text-muted-foreground">No offers entered yet.</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-max border-collapse">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3 text-xs text-muted-foreground">Per year unless it says four years</th>
                    {columns.map((c) => (
                      <th key={c.item.id} className="py-1 pr-3">
                        {c.school.name}
                        <span className="block text-xs font-normal text-muted-foreground">{awardYearLabel(c.offer!.award_year)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Cost of attendance", (c) => (c.view!.coa.total !== null ? `${usd(c.view!.coa.total)}${c.view!.coa.source === "ipeds" ? ` (the site's full price${c.view!.coa.year ? `, ${c.view!.coa.year}` : ""}: the letter didn't state it)` : ""}` : "Not stated")],
                      ["Gift aid", (c) => usd(c.view!.gifts.total)],
                      ["Net cost", (c) => (c.view!.netCost !== null ? usd(c.view!.netCost) : "—")],
                      ["Work-study, if earned", (c) => usd(c.view!.workStudy)],
                      ["Student loans offered", (c) => usd(c.view!.loans.headline)],
                      ["Parent PLUS and private (not aid)", (c) => usd(c.view!.loans.notAid)],
                      ["Four-year cost", (c) => (c.four!.totals.coa !== null ? usd(c.four!.totals.coa) : "—")],
                      ["Four-year gift aid", (c) => `${usd(c.four!.totals.gift)}${c.four!.bothWays ? ` (${usd(c.four!.totals.giftIfNotRenewed)} if unstated renewals stop)` : ""}`],
                      ["Four-year net cost", (c) => (c.four!.totals.net !== null ? `${usd(c.four!.totals.net)}${c.four!.bothWays && c.four!.totals.netIfNotRenewed !== null ? ` (${usd(c.four!.totals.netIfNotRenewed)})` : ""}` : "—")],
                      ["Four-year student loans", (c) => usd(c.four!.totals.studentFederal)],
                      ["Monthly payment, 10-year standard plan", (c) => (c.four!.student ? usd(c.four!.student.monthly) : "No student loans")],
                      ["Questions to ask", (c) => String(c.flags.filter((f) => f.question).length)],
                    ] as [string, (c: (typeof columns)[number]) => string][]
                  ).map(([label, cell]) => (
                    <tr key={label} className="border-b last:border-0">
                      <th className="py-1 pr-3 text-left text-xs font-semibold text-muted-foreground">{label}</th>
                      {columns.map((c) => (
                        <td key={c.item.id} className="py-1 pr-3 tabular-nums">
                          {cell(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th className="py-1 pr-3 text-left text-xs font-semibold text-muted-foreground">Published context</th>
                    {columns.map((c) => (
                      <td key={c.item.id} className="py-1 pr-3 align-top text-xs">
                        {c.facts?.gradRate != null && (
                          <MetricLabel cited={cited(c.facts.gradRateCite)}>
                            <span>graduation {pct(c.facts.gradRate)}</span>
                          </MetricLabel>
                        )}{" "}
                        {c.facts?.earnings != null && (
                          <MetricLabel cited={cited(c.facts.earningsCite)}>
                            <span>earnings {usd(c.facts.earnings)}</span>
                          </MetricLabel>
                        )}{" "}
                        {c.facts?.debt != null && (
                          <MetricLabel cited={cited(c.facts.debtCite)}>
                            <span>median debt {usd(c.facts.debt)}</span>
                          </MetricLabel>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {columns.some((c) => c.notes.pros || c.notes.cons) && (
            <ul className="space-y-1">
              {columns
                .filter((c) => c.notes.pros || c.notes.cons)
                .map((c) => (
                  <li key={c.item.id}>
                    <span className="font-semibold">{c.school.name}:</span> {c.notes.pros ? `pros: ${c.notes.pros}` : ""}
                    {c.notes.pros && c.notes.cons ? "; " : ""}
                    {c.notes.cons ? `cons: ${c.notes.cons}` : ""}
                  </li>
                ))}
            </ul>
          )}
        </section>

        <footer className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Sources.</span> Offers, visits, ratings, and notes are the family&apos;s own entries. College figures:{" "}
            {sources.length ? sources.map((s) => `${s.label}${s.year ? ` (${s.year})` : ""}`).join("; ") : "none shown"}.
            {history.length > 0 && <> Cost trends (nominal): {history.map((h) => `${h.label}, ${h.years}`).join("; ")}.</>}
            {rateYears.length > 0 && (
              <>
                {" "}
                Federal loan rates and limits: Federal Student Aid ({rateYears.map(awardYearLabel).join(", ")} rates; {LOANS.rates.find((r) => r.award_year === rateYears[0])?.source}).
              </>
            )}{" "}
            Four-year costs grow at each college&apos;s own recent rate; payments leave out interest that builds during college.
          </p>
        </footer>
      </article>
    </div>
  );
}
