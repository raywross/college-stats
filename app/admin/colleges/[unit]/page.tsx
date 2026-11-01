import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Empty, Fields, Muted, PageHeader, Panel } from "@/components/admin/Panel";
import { HealthChip } from "@/components/admin/ops/OpsStatusChip";
import { EstimateInputsPanel } from "@/components/admin/EstimateInputsPanel";
import { collegeInputsFor } from "@/lib/admin/estimate-inputs-load";
import { DailyViews, TopBars } from "@/components/admin/ViewCharts";
import { SelectivityHistory } from "@/components/admin/SelectivityHistory";
import { collegeHistory, historyInstalled, type SelectivityPoint } from "@/lib/admin/selectivity-history";
import { githubRepo } from "@/lib/github-app";
import { collegeViewers, VIEW_CHART_DAYS, type ViewerRow } from "@/lib/admin/college-views";
import { SourceNote } from "@/components/sources/SourceNote";
import { requireAdmin } from "@/lib/admin/auth";
import { adminCollege } from "@/lib/admin/college";
import { readingText, type GpaPanel, type HiddenFieldRow, type ModelFit, type SelectivityPanel, type SelectivityPoolView } from "@/lib/admin/hidden";
import { GROUP_LABELS, STATUS_LABELS } from "@/lib/admin/health-rules";
import type { CollegeHealth } from "@/lib/admin/health";
import { failureSummary } from "@/lib/admin/health-view";
import { dayLabel } from "@/lib/admin/ops-view";
import { getData } from "@/lib/data";
import type { FieldPath } from "@/lib/fields";
import { pctSmart } from "@/lib/format";
import { tierText } from "@/lib/selectivity-tier";
import { SELECTIVITY_TIER_LABELS } from "@/lib/chances/levels";
import type { School } from "@/lib/types";

export const metadata: Metadata = { title: "College", robots: { index: false, follow: false } };

/**
 * /admin/colleges/[unit] (specs/product/admin.md "A college"): the public header (name, tier, admit rate as cited),
 * then what the site computes but never shows: the selectivity breakdown (the one place the weights are visible), the
 * GPA the standing model reads, and every hidden registry field with its lineage, all below the facts the estimate reads with
 * their sources and dates (specs/product/admin-health-views.md); then the college's data health card
 * with its open failures and review-queue items, a Rerun link that opens Operations with this college filled in, and
 * Review (the college's pending rows, /admin/colleges/[unit]/review), also beside Edit in the header.
 * Server-rendered behind requireAdmin(); nothing here reaches a client bundle.
 */
export default async function CollegePage({ params, searchParams }: PageProps<"/admin/colleges/[unit]">) {
  await connection();
  await requireAdmin();
  const { unit } = await params;
  if (!/^\d{6,8}$/.test(unit)) notFound();
  const college = await adminCollege(unit);
  if (!college) notFound();
  const { school, selectivity, gpa, hidden, health, healthGenerated } = college;
  const rate = school.admissions.acceptance_rate;
  const tier = tierText(school);
  const opsHref = `/admin/operations?unit=${unit}`;
  const looking = await collegeViewers(unit);
  const history = (await historyInstalled()) ? await collegeHistory(unit) : null;
  const every = (await searchParams).every === "1";
  const inputs = await collegeInputsFor(unit).catch((err) => {
    console.error("[admin college] the estimate inputs could not be worked out; the panel is left out.", err);
    return null;
  });

  return (
    <>
      <PageHeader
        back={
          <Link href="/admin/colleges" className="text-muted-foreground underline-offset-4 hover:underline">
            Colleges
          </Link>
        }
        title={school.name}
        chips={<span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">{tier ?? "Not rated"}</span>}
        subtitle={
          <>
            {school.location.city}, {school.location.state} · {rate === null ? "No admit rate" : `${pctSmart(rate)} admitted`} · unit {unit} ·{" "}
            <Link href={`/schools/${unit}`} className="underline-offset-4 hover:underline">
              Public profile
            </Link>{" "}
            <Link href={`/admin/colleges/${unit}/edit`} className="ml-1 inline-flex h-8 items-center rounded-full border px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Edit
            </Link>
            <Link href={`/admin/colleges/${unit}/review`} className="ml-1 inline-flex h-8 items-center rounded-full border px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Review
            </Link>
          </>
        }
      />
      <SourceNote fields={["admissions.acceptance_rate", "selectivity.tier"]} school={school} className="-mt-3 mb-5" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          <EstimateInputsPanel inputs={inputs} />
          <SelectivityBlock panel={selectivity} school={school} />
          <HistoryBlock points={history} every={every} unit={unit} />
          <GpaBlock panel={gpa} school={school} />
          <HiddenBlock rows={hidden} school={school} />
        </div>
        <aside className="min-w-0 space-y-5">
          <HealthBlock health={health} generated={healthGenerated} opsHref={opsHref} reviewHref={`/admin/colleges/${unit}/review`} />
          <ViewersBlock unit={unit} looking={looking} />
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Selectivity                                                         */
/* ------------------------------------------------------------------ */

const fmt = (v: number, d = 2) => v.toFixed(d);

function SelectivityBlock({ panel, school }: { panel: SelectivityPanel; school: School }) {
  const { constants } = panel;
  const fields = [...new Set(panel.pools.flatMap((p) => p.rows.map((r) => r.field)))] as FieldPath[];
  return (
    <Panel title="Selectivity" id="selectivity" aside={<Muted>Hidden: never on a public page</Muted>}>
      {panel.status === "inconsistent" ? (
        <Empty>Not rated: the college reports more first-years enrolled than undergraduates in all, so its figures can&apos;t describe one class.</Empty>
      ) : panel.status === "no_admit_rate" ? (
        <Empty>Not rated: the college publishes no admit rate.</Empty>
      ) : (
        <div className="space-y-6">
          {panel.pools.map((p) => (
            <PoolBlock key={p.pool} pool={p} />
          ))}
          {panel.topBand && <p className="text-sm">{panel.topBand.sentence}</p>}
          <SourceNote fields={fields} school={school} />
        </div>
      )}
      <div className="mt-5 space-y-1 border-t pt-3 text-xs text-muted-foreground">
        <p>
          Weights: {constants.weights.map((w) => `${w.label} ${w.weight}`).join(" · ")}. Score = {constants.center} + {constants.spread} × weighted mean × admitted ÷ (admitted + {constants.evidenceAdmits}), held to 0–100.
        </p>
        <p>
          Cutoffs: {constants.cutoffs.filter((c) => c.at !== null).map((c) => `${c.label} ${c.at}`).join(" · ")}; a stored tier moves only when the score crosses by {constants.hysteresis} points. Top band of Ultra selective at {constants.topBandScore}.
        </p>
        <p>{panel.trend}</p>
      </div>
    </Panel>
  );
}

function PoolBlock({ pool }: { pool: SelectivityPoolView }) {
  return (
    <section aria-label={pool.label} className="space-y-2">
      <h3 className="flex flex-wrap items-baseline gap-x-3 text-base font-bold">
        {pool.label}
        <span className="text-sm font-normal text-muted-foreground">
          score <span className="font-mono text-foreground tabular-nums">{fmt(pool.score)}</span> · plain cutoffs: {SELECTIVITY_TIER_LABELS[pool.plainTier]} · stored: {pool.publishedTier ? SELECTIVITY_TIER_LABELS[pool.publishedTier] : "none"}
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-semibold">Input</th>
              <th className="py-1.5 pr-3 font-semibold">Value</th>
              <th className="py-1.5 pr-3 font-semibold">Percentile</th>
              <th className="py-1.5 pr-3 font-semibold">Reading</th>
              <th className="py-1.5 pr-3 font-semibold">Weight</th>
              <th className="py-1.5 font-semibold">Contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y tabular-nums">
            {pool.rows.map((r) => (
              <tr key={r.input}>
                <td className="py-1.5 pr-3 font-medium">{r.label}</td>
                <td className="py-1.5 pr-3">
                  {r.display}
                  {!r.present && <span className="block text-xs text-muted-foreground">{r.filled === "fit" ? "filled from the fit on the other four" : "read as the middle"}</span>}
                </td>
                <td className="py-1.5 pr-3">{r.percentile === null ? <Muted>—</Muted> : `${fmt(r.percentile, 1)}`}</td>
                <td className="py-1.5 pr-3 font-mono text-[13px]">{readingText(r.reading)}</td>
                <td className="py-1.5 pr-3">{r.weight}</td>
                <td className="py-1.5 font-mono text-[13px]">{readingText(r.contribution)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Weighted mean {readingText(pool.weightedMean)} × evidence {fmt(pool.evidence.factor, 3)} ({pool.evidence.admitted === null ? "no admitted count" : `${pool.evidence.admitted.toLocaleString("en-US")} admitted`}) → {fmt(pool.unclamped)}
        {pool.unclamped !== pool.exact ? `, held to ${fmt(pool.exact)}` : ""}. Percentile: harder than that share of reporting colleges. Reading: standard deviations from the reporters&apos; mean.
      </p>
      <p className="text-sm">{pool.hysteresis.sentence}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* GPA                                                                 */
/* ------------------------------------------------------------------ */

const fitText = (f: ModelFit) => `${f.n} colleges, typical miss ${f.meanError.toFixed(2)}, 90% under ${f.p90Error.toFixed(2)}`;

function GpaBlock({ panel, school }: { panel: GpaPanel; school: School }) {
  const items = [
    { label: "Source", value: panel.kindLabel },
    { label: "Point", value: panel.point ?? <Muted>None</Muted> },
    { label: "Range the comparison uses", value: panel.range ?? <Muted>None</Muted> },
    ...(panel.weighted ? [{ label: "Weighted average (bound)", value: panel.weighted }] : []),
    ...(panel.middle
      ? [
          { label: `Middle 50% (${panel.middle.kind === "bands" ? "from the bands" : "estimated"})`, value: panel.middle.shown },
          { label: "25th percentile", value: panel.middle.p25 },
          { label: "75th percentile", value: panel.middle.p75 },
        ]
      : []),
    ...(panel.model ? [{ label: "Average model", value: fitText(panel.model) }] : []),
    ...(panel.curve ? [{ label: "25th-percentile model", value: fitText(panel.curve.p25) }, { label: "75th-percentile model", value: fitText(panel.curve.p75) }] : []),
    ...panel.inputs.map((i) => ({ label: `Model input: ${i.label}`, value: i.value })),
  ];
  return (
    <Panel title="GPA" id="gpa" aside={<Muted>What the standing model reads</Muted>}>
      <Fields items={items} />
      {panel.field && <SourceNote fields={[panel.field]} school={school} className="mt-3" />}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Hidden derived fields                                               */
/* ------------------------------------------------------------------ */

async function HiddenBlock({ rows, school }: { rows: HiddenFieldRow[]; school: School }) {
  const { citeField } = await getData();
  return (
    <Panel title="Derived, not shown" id="hidden" aside={<Muted>Registry fields marked hidden</Muted>}>
      {rows.length === 0 ? (
        <Empty>No registry field is marked hidden.</Empty>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((r) => {
            const c = citeField(r.path, school);
            return (
              <li key={r.path} className="space-y-0.5 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{r.label}</span>
                  <span className="font-mono text-[13px] tabular-nums">{r.value ?? <Muted>None for this college</Muted>}</span>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{r.path}</p>
                <p className="text-xs text-muted-foreground">
                  {c.method === "derived" ? "Derived" : "Stored"} · {c.label}
                  {c.year ? `, ${c.year}` : ""}
                  {c.inputs?.length ? ` · from ${c.inputs.map((i) => `${i.label}${i.year ? ` ${i.year}` : ""}`).join("; ")}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

function HealthBlock({ health, generated, opsHref, reviewHref }: { health: CollegeHealth | null; generated: string | null; opsHref: string; reviewHref: string }) {
  return (
    <Panel title="Files and collection" id="health" aside={health ? <HealthChip status={health.overall} /> : undefined}>
      {!health ? (
        <Empty>No health card: this college isn&apos;t in the health file, or the file couldn&apos;t be read.</Empty>
      ) : (
        <div className="space-y-4 text-sm">
          <ul className="space-y-3">
            {health.rows.map((r) => (
              <li key={r.group} className="space-y-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  <span className="font-medium">{GROUP_LABELS[r.group]}</span>
                  <HealthChip status={r.status} />
                </div>
                {r.covers && (
                  <p className="text-xs">
                    <span className="font-semibold">Covers</span> {r.covers}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {r.judgedBy ? `Collected ${dayLabel(r.judgedBy)} · ` : ""}
                  {r.link ? (
                    <a href={r.link} className="underline-offset-2 hover:underline" rel="noreferrer" target="_blank">
                      {r.reason}
                    </a>
                  ) : (
                    r.reason
                  )}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Overall {STATUS_LABELS[health.overall]}
            {health.changed ? ` · last changed ${dayLabel(health.changed.at)} (${health.changed.fields} field${health.changed.fields === 1 ? "" : "s"})` : ""}
            {generated ? ` · health inputs from ${dayLabel(generated)}` : ""}
          </p>
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Open failures</h3>
            <p className="mt-0.5">{health.failures.length ? failureSummary(health.failures) : <Muted>None</Muted>}</p>
            {health.failures.length > 0 && <p className="text-xs text-muted-foreground">Stages: {[...new Set(health.failures.map((f) => f.stage))].join(", ")}</p>}
          </div>
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Review queue</h3>
            <p className="mt-0.5">
              {health.queueItems ? (
                <Link href={reviewHref} className="underline decoration-dotted underline-offset-2">
                  {health.queueItems.toLocaleString("en-US")} item{health.queueItems === 1 ? "" : "s"}
                </Link>
              ) : (
                <Muted>None</Muted>
              )}
            </p>
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={opsHref} className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Rerun in Operations
        </Link>
        <Link href={reviewHref} className="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-semibold hover:bg-muted">
          Review
        </Link>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Who's looking                                                       */
/* ------------------------------------------------------------------ */

/** Where a viewer row drills in: the person's views of this college, or the signed-out visits. */
function viewerHref(unit: string, v: ViewerRow): string {
  return v.userId ? `/admin/people/${v.userId}/views?unit=${unit}` : `/admin/colleges/${unit}/views?signed_out=1`;
}

function ViewersBlock({ unit, looking }: { unit: string; looking: Awaited<ReturnType<typeof collegeViewers>> }) {
  return (
    <Panel
      title="Who's looking"
      id="views"
      aside={
        looking.total > 0 ? (
          <Link href={`/admin/colleges/${unit}/views`} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
            All
          </Link>
        ) : undefined
      }
    >
      {looking.total === 0 ? (
        <Empty>No views recorded yet.</Empty>
      ) : (
        <div className="space-y-5 text-sm">
          <p className="text-muted-foreground">
            {looking.total.toLocaleString("en-US")} {looking.total === 1 ? "view" : "views"} · {looking.people.toLocaleString("en-US")} signed-in{" "}
            {looking.people === 1 ? "person" : "people"} · {looking.signedOut.toLocaleString("en-US")} signed out
          </p>
          <DailyViews days={looking.days} label={`Last ${VIEW_CHART_DAYS} days`} />
          <TopBars
            unit={["view", "views"]}
            rows={looking.viewers.slice(0, 8).map((v) => ({
              key: v.userId ?? "signed-out",
              label: v.userId ? (v.name ?? v.email ?? "No name") : "Signed-out visitors",
              sub: v.userId ? (v.name && v.email ? v.email : undefined) : "Not tied to anyone",
              value: v.views,
              href: viewerHref(unit, v),
            }))}
          />
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Selectivity history                                                 */
/* ------------------------------------------------------------------ */

function HistoryBlock({ points, every, unit }: { points: SelectivityPoint[] | null; every: boolean; unit: string }) {
  return (
    <Panel
      title="Selectivity history"
      id="selectivity-history"
      aside={
        <Link href="/admin/selectivity" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
          Every college
        </Link>
      }
    >
      {points === null ? (
        <Empty>Not set up yet: apply supabase/migrations/20261013150000_selectivity_history.sql and 20261020120000_selectivity_history_one_row.sql, then publish: the publisher records the tiers at each publish.</Empty>
      ) : points.length === 0 ? (
        <Empty>Nothing recorded for this college yet.</Empty>
      ) : (
        <SelectivityHistory
          points={points}
          repoUrl={`https://github.com/${githubRepo()}`}
          every={every}
          toggleHref={`/admin/colleges/${unit}${every ? "" : "?every=1"}#selectivity-history`}
        />
      )}
    </Panel>
  );
}
