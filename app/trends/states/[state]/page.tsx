import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import { getData, getHistoryFiles, getTrendFile } from "@/lib/data";
import { historyYearLabel } from "@/lib/history";
import { pct, points } from "@/lib/format";
import { moverList } from "@/lib/movers";
import type { School } from "@/lib/types";
import type { StateEntry, StateMeasures } from "@/lib/trends";
import { Sparkline } from "@/components/charts/Sparkline";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { MoverListCard } from "@/components/trends/movers/MoverListCard";
import { Term } from "@/components/ui/info-tip";

type Props = { params: Promise<{ state: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const file = await getTrendFile("states");
  const entry = file?.states.find((s) => s.postal === state.toUpperCase());
  return {
    title: entry ? `${entry.name}: trends` : "State not found",
    description: entry ? `How ${entry.name}'s colleges changed over ten years: undergraduates, applications, cost, and where first-years come from.` : undefined,
  };
}

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;
// An empty list renders each state on first visit and caches it, like conference pages
// (node_modules/next/dist/docs: generateStaticParams, "All paths at runtime").
export async function generateStaticParams() {
  return [];
}

function changeText(v: number): string {
  const r = Math.round(v * 100);
  return `${r > 0 ? "+" : ""}${r}%`;
}

/** A stat tile with a sparkline against the national median (dashed), for the state's "how it changed" section. */
function StatTile({
  label,
  state,
  national,
  start,
  kind,
  format,
  change,
}: {
  label: string;
  state: (number | null)[];
  national: (number | null)[];
  start: number;
  kind: "fall" | "academic";
  format: "compact" | "pctSmart" | "money";
  /** The state's own then→now change, printed under the sparkline. */
  change: string;
}) {
  return (
    <div className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-2 font-display text-2xl font-extrabold tracking-tight tabular-nums">{change}</p>
      <p className="text-xs text-muted-foreground">over 10 years, median college</p>
      <div className="mt-3">
        <Sparkline
          label={`${label}, this state (solid) vs the national median (dashed)`}
          start={start}
          kind={kind}
          format={format}
          height={56}
          series={[
            { name: "This state", color: "var(--primary)", values: state },
            { name: "National median", color: "var(--muted-foreground)", dashed: true, values: national },
          ]}
        />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: "var(--primary)" }} /> This state
        </li>
        <li className="inline-flex items-center gap-1.5">
          <svg width="14" height="4" aria-hidden>
            <line x1="1" x2="13" y1="2" y2="2" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" />
          </svg>
          National median
        </li>
      </ul>
    </div>
  );
}

function ControlCard({ title, v, n, tooFew }: { title: string; v: StateMeasures | undefined; n: number; tooFew?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-semibold">{title}</h4>
        <span className="text-xs text-muted-foreground">{n.toLocaleString("en-US")} colleges</span>
      </div>
      {tooFew || !v ? (
        <p className="mt-3 text-sm text-muted-foreground">
          <Term term="too-few-colleges">Too few colleges to say</Term>
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Undergrads</dt>
            <dd className="font-semibold tabular-nums">{changeText(v.undergradsMedianChange)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Applicants</dt>
            <dd className="font-semibold tabular-nums">{changeText(v.applicantsMedianChange)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Acceptance rate</dt>
            <dd className="font-semibold tabular-nums">{points(v.acceptanceRateMedianChange)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Average cost</dt>
            <dd className="font-semibold tabular-nums">{changeText(v.avgPaidMedianChange)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/**
 * /trends/states/{state} (specs/trends/states.md): header, four stat tiles vs the national median, public/private
 * split, where first-years come from, this state's movers, public research universities, and the method note. A
 * state under STATE_FLOOR gets counts, its member list, and movers only (rule 1).
 */
export default async function StatePage({ params }: Props) {
  const { state } = await params;
  const postal = state.toUpperCase();
  const [file, files, data] = await Promise.all([getTrendFile("states"), getHistoryFiles(), getData()]);
  const entry: StateEntry | undefined = file?.states.find((s) => s.postal === postal);
  if (!file || !files || !entry) notFound();

  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const academic = (y: number) => historyYearLabel(y, "academic").toLowerCase();

  const moverIds = entry.movers.flatMap((w) => w.lists.flatMap((l) => l.entries.map((e) => e.unit_id)));
  const schools = new Map<string, School>(data.getSchoolsByIds(moverIds).map((s) => [s.unit_id, s]));
  const window10 = entry.movers.find((w) => w.years === 10);

  if (entry.tooFew || !entry.all || !entry.control || !entry.sparkLines) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
        <Link href="/trends/states" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
          <ArrowLeft className="size-4" /> Trends by state
        </Link>
        <header className="mt-4 mb-8 max-w-3xl">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">
            <MapPin className="size-4" /> Trends by state
          </p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{entry.name}</h1>
          <p className="mt-3 text-muted-foreground">
            {entry.onSite.total.toLocaleString("en-US")} college{entry.onSite.total === 1 ? "" : "s"} on the site — too few to summarize with a median (the site
            needs {file.floor} or more). Here&apos;s who they are, and this state&apos;s biggest movers.
          </p>
        </header>
        <section aria-labelledby="members" className="max-w-3xl">
          <h2 id="members" className="font-display text-xl font-bold">
            Colleges in {entry.name}
          </h2>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {entry.members.map((m) => (
              <li key={m.unit_id}>
                <Link href={`/schools/${m.unit_id}`} className="text-sm hover:text-primary hover:underline">
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={`/explore?states=${entry.postal}`} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
            See them in Explore <ArrowRight className="size-3.5" />
          </Link>
        </section>
        {window10 && (
          <section aria-labelledby="movers" className="mt-12">
            <h2 id="movers" className="font-display text-2xl font-extrabold tracking-tight">
              Biggest movers in {entry.name}
            </h2>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {window10.lists.map((list) => (
                <MoverListCard key={list.key} def={moverList(list.key)} list={list} window={10} schools={schools} files={files} shown={10} compact />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  const all = entry.all.values!;
  const publicRow = entry.control.groups.find((g) => g.key === "public");
  const privateRow = entry.control.groups.find((g) => g.key === "private-nonprofit");
  const sl = entry.sparkLines;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <Link href="/trends/states" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> Trends by state
      </Link>
      <header className="mt-4 mb-8 max-w-3xl sm:mb-10">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">
          <MapPin className="size-4" /> Trends by state
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{entry.name}</h1>
        <p className="mt-3 text-muted-foreground">
          {entry.onSite.total.toLocaleString("en-US")} colleges on the site: {entry.onSite.public.toLocaleString("en-US")} public,{" "}
          {entry.onSite.privateNonprofit.toLocaleString("en-US")} private nonprofit
          {entry.onSite.privateForprofit > 0 && <>, {entry.onSite.privateForprofit.toLocaleString("en-US")} for-profit</>}. Their undergraduates{" "}
          {all.undergradsTotalChange >= 0 ? "grew" : "fell"} {Math.abs(Math.round(all.undergradsTotalChange * 100))}% in total since {fall(file.from)}, to{" "}
          {all.undergradsTotal[1].toLocaleString("en-US")} today ({entry.panel.n.toLocaleString("en-US")} of {entry.onSite.total.toLocaleString("en-US")}{" "}
          {entry.name} colleges in the panel).
        </p>
        <Link href={`/explore?states=${entry.postal}`} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
          Explore {entry.name}&apos;s colleges <ArrowRight className="size-3.5" />
        </Link>
      </header>

      <section aria-labelledby="changed">
        <h2 id="changed" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          How {entry.name}&apos;s colleges changed
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          The median {entry.name} college, {fall(file.from)} to {fall(file.to)}, against the national median (dashed) over the same <Term term="fixed-panel">fixed panel</Term>.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Undergraduates" state={sl.undergrads} national={file.national.sparkLines.undergrads} start={file.lineFrom} kind="fall" format="compact" change={changeText(all.undergradsMedianChange)} />
          <StatTile label="Applicants" state={sl.applicants} national={file.national.sparkLines.applicants} start={file.lineFrom} kind="fall" format="compact" change={changeText(all.applicantsMedianChange)} />
          <StatTile label="Acceptance rate" state={sl.acceptanceRate} national={file.national.sparkLines.acceptanceRate} start={file.lineFrom} kind="fall" format="pctSmart" change={points(all.acceptanceRateMedianChange)} />
          <StatTile label="Average total cost" state={sl.avgPaid} national={file.national.sparkLines.avgPaid} start={file.fromMoney} kind="academic" format="money" change={changeText(all.avgPaidMedianChange)} />
        </div>
      </section>

      <section aria-labelledby="control" className="mt-12">
        <h2 id="control" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Public and private
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          State stories are often public-system stories: a state&apos;s publics shrinking while its privates hold, or the reverse.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ControlCard title="Public" v={publicRow?.values} n={publicRow?.n ?? 0} tooFew={publicRow?.tooFew} />
          <ControlCard title="Private nonprofit" v={privateRow?.values} n={privateRow?.n ?? 0} tooFew={privateRow?.tooFew} />
        </div>
      </section>

      {entry.outOfState && (
        <section aria-labelledby="origins" className="mt-12">
          <h2 id="origins" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Where {entry.name}&apos;s first-years come from
          </h2>
          <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <h3 className="mb-3 text-sm font-semibold">Top sending states</h3>
              {entry.topSendingStates.length ? (
                <ol className="space-y-2.5">
                  {entry.topSendingStates.map((s) => (
                    <li key={s.state} className="flex items-baseline justify-between gap-2 text-sm">
                      <span>{s.state === entry.postal ? `${entry.name} (in-state)` : s.state}</span>
                      <b className="tabular-nums">{pct(s.share)}</b>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No college&apos;s home-state table is available yet for {entry.name}.</p>
              )}
            </div>
            <div className="space-y-4">
              {(["public", "privateNonprofit"] as const).map((k) => {
                const side = entry.outOfState![k];
                const label = k === "public" ? "Public" : "Private nonprofit";
                return (
                  <div key={k} className="rounded-2xl border bg-card p-4">
                    <p className="text-sm font-semibold">
                      {label}: <Term term="in-state-student">out-of-state first-years</Term>
                    </p>
                    {!side ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <Term term="too-few-colleges">Too few colleges to say</Term>
                      </p>
                    ) : (
                      <>
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          {pct(side.thenNow[0])} → {pct(side.thenNow[1])} ({side.n} colleges)
                        </p>
                        <div className="mt-2">
                          <Sparkline label={`${label} out-of-state share, ${fall(entry.outOfState!.lineFrom)} to ${fall(entry.outOfState!.to)}`} start={entry.outOfState!.lineFrom} kind="fall" format="pct" height={56} series={[{ name: label, color: "var(--primary)", values: side.line }]} />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {window10 && (
        <section aria-labelledby="movers" className="mt-12">
          <h2 id="movers" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Biggest movers in {entry.name}
          </h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            The same <Term term="biggest-movers">rules and floors</Term> as the national lists, restricted to {entry.name}&apos;s colleges.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {window10.lists.map((list) => (
              <MoverListCard key={list.key} def={moverList(list.key)} list={list} window={10} schools={schools} files={files} shown={10} compact />
            ))}
          </div>
        </section>
      )}

      {entry.researchUnis.length > 0 && (
        <section aria-labelledby="research" className="mt-12 max-w-3xl">
          <h2 id="research" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Public research universities
          </h2>
          <p className="mt-2 text-muted-foreground">
            {entry.name}&apos;s public R1 and R2 universities (Carnegie 2025), with their undergraduate change over the same window. No classification in the data
            means &quot;flagship,&quot; so this is simply the state&apos;s public research universities.
          </p>
          <ul className="mt-4 divide-y rounded-2xl border">
            {entry.researchUnis.map((r) => (
              <li key={r.unit_id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <Link href={`/schools/${r.unit_id}`} className="font-semibold hover:text-primary hover:underline">
                    {r.name}
                  </Link>
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{r.tier}</span>
                </span>
                <b className="shrink-0 tabular-nums">{r.change === null ? "—" : changeText(r.change)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="method" className="mt-14 max-w-3xl">
        <h2 id="method" className="font-display text-2xl font-extrabold tracking-tight">
          How this was measured
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground marker:text-border">
          <li>
            <b className="text-foreground">Which colleges.</b> Colleges with 300 or more undergraduates in both {fall(file.from)} and {fall(file.to)}:{" "}
            {entry.panel.n.toLocaleString("en-US")} of {entry.onSite.total.toLocaleString("en-US")} {entry.name} colleges. It&apos;s a{" "}
            <Term term="fixed-panel">fixed panel</Term>, so colleges entering or leaving the data don&apos;t look like change.
          </li>
          <li>
            <b className="text-foreground">Average total cost</b> is an academic-year figure, one year behind fall: {academic(file.fromMoney)} to {academic(file.toMoney)}, after inflation.
          </li>
          <li>
            <b className="text-foreground">Out-of-state shares</b> are collected in even-numbered falls only; odd years are gaps, not zeros.
          </li>
          <li>
            <b className="text-foreground">Totals and medians both appear</b> because they can diverge: a state&apos;s total can fall more (or less) than its
            median college when its biggest colleges move differently.
          </li>
          <li>
            <b className="text-foreground">No policy attribution.</b> This page shows what changed, not why; a state&apos;s mix of public, private, and
            for-profit colleges, and its system policies, aren&apos;t broken out as causes.
          </li>
        </ul>
        <HistorySourceNote keys={["undergrads", "applicants", "acceptance_rate", "avg_paid_all", "out_of_state_share"]} files={files} range={[file.from, file.to]} className="mt-4" />
      </section>

      <nav aria-label="Related" className="mt-10 flex flex-wrap gap-2">
        <Link href={`/explore?states=${entry.postal}`} className="group inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary">
          Explore {entry.name}&apos;s colleges <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link href="/trends/states" className="group inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary">
          Every state <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link href="/trends" className="group inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary">
          All national trends <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </nav>
    </div>
  );
}
