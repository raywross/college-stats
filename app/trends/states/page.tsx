import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Map as MapIcon } from "lucide-react";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { historyYearLabel } from "@/lib/history";
import type { TileRange } from "@/components/charts/StateTileMap";
import { StateMeasureMap, type StateMapMeasureDef } from "@/components/trends/states/StateMeasureMap";
import { StatesTable, type StatesTableRow } from "@/components/trends/states/StatesTable";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { Term } from "@/components/ui/info-tip";

export const metadata: Metadata = {
  title: "Trends by state",
  description: "How each state's colleges changed over ten years: undergraduates, acceptance rates, cost, out-of-state students, and test policy, state by state.",
};

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

/** Diverging: orange = shrank, blue = grew, gray = little change (specs/design-system.md --div-1..5). */
const CHANGE_RANGES: TileRange[] = [
  { lo: -Infinity, hi: -0.1, label: "Shrank 10%+", bg: "var(--div-1)", ink: "text-white dark:text-background" },
  { lo: -0.1, hi: -0.02, label: "Shrank some", bg: "var(--div-2)", ink: "text-foreground" },
  { lo: -0.02, hi: 0.02, label: "Little change", bg: "var(--div-3)", ink: "text-foreground" },
  { lo: 0.02, hi: 0.1, label: "Grew some", bg: "var(--div-4)", ink: "text-foreground" },
  { lo: 0.1, hi: Infinity, label: "Grew 10%+", bg: "var(--div-5)", ink: "text-white dark:text-background" },
];
const ACCEPTANCE_RANGES: TileRange[] = [
  { lo: 0, hi: 0.25, label: "Under 25%", bg: "var(--seq-1)", ink: "text-foreground" },
  { lo: 0.25, hi: 0.4, label: "25–40%", bg: "var(--seq-2)", ink: "text-foreground" },
  { lo: 0.4, hi: 0.55, label: "40–55%", bg: "var(--seq-3)", ink: "text-foreground" },
  { lo: 0.55, hi: 0.7, label: "55–70%", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { lo: 0.7, hi: Infinity, label: "70%+", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];
const COST_RANGES: TileRange[] = [
  { lo: 0, hi: 18_000, label: "Under $18K", bg: "var(--seq-1)", ink: "text-foreground" },
  { lo: 18_000, hi: 22_000, label: "$18K–22K", bg: "var(--seq-2)", ink: "text-foreground" },
  { lo: 22_000, hi: 26_000, label: "$22K–26K", bg: "var(--seq-3)", ink: "text-foreground" },
  { lo: 26_000, hi: 32_000, label: "$26K–32K", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { lo: 32_000, hi: Infinity, label: "$32K+", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];
const OOS_RANGES: TileRange[] = [
  { lo: 0, hi: 0.05, label: "Under 5%", bg: "var(--seq-1)", ink: "text-foreground" },
  { lo: 0.05, hi: 0.1, label: "5–10%", bg: "var(--seq-2)", ink: "text-foreground" },
  { lo: 0.1, hi: 0.2, label: "10–20%", bg: "var(--seq-3)", ink: "text-foreground" },
  { lo: 0.2, hi: 0.35, label: "20–35%", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { lo: 0.35, hi: Infinity, label: "35%+", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];
const TEST_OPTIONAL_RANGES: TileRange[] = [
  { lo: 0, hi: 0.5, label: "Under 50%", bg: "var(--seq-1)", ink: "text-foreground" },
  { lo: 0.5, hi: 0.75, label: "50–75%", bg: "var(--seq-2)", ink: "text-foreground" },
  { lo: 0.75, hi: 0.9, label: "75–90%", bg: "var(--seq-3)", ink: "text-foreground" },
  { lo: 0.9, hi: 0.99, label: "90–99%", bg: "var(--seq-4)", ink: "text-white dark:text-background" },
  { lo: 0.99, hi: Infinity, label: "~All", bg: "var(--seq-5)", ink: "text-white dark:text-background" },
];

/**
 * /trends/states (specs/trends/states.md): the state tile map (segmented control over 5 measures) and a sortable
 * table of every state and territory, from data/history/trends/states.json.
 */
export default async function StatesIndexPage() {
  const [file, files] = await Promise.all([getTrendFile("states"), getHistoryFiles()]);

  if (!file || !files) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
        <Link href="/trends" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
          <ArrowLeft className="size-4" /> National trends
        </Link>
        <div className="mt-6 rounded-3xl border border-dashed p-6 text-muted-foreground sm:p-8">
          <p className="font-semibold text-foreground">Trends by state aren&apos;t available yet.</p>
          <p className="mt-1 text-sm">They&apos;re computed from the site&apos;s year-by-year history, and appear once that data is published.</p>
        </div>
      </div>
    );
  }

  const states = file.states.filter((s) => !s.territory);
  const territories = file.states.filter((s) => s.territory);
  const ordered = [...states, ...territories];

  const valuesOf = (key: "undergradChange" | "acceptanceRate" | "avgCost" | "outOfState" | "testOptionalShare") =>
    Object.fromEntries(file.states.map((s) => [s.postal, s.map[key]]));

  const measures: StateMapMeasureDef[] = [
    {
      key: "undergradChange",
      label: "Undergraduate change",
      legendLabel: "Median college's undergraduate change, 10 years",
      values: valuesOf("undergradChange"),
      ranges: CHANGE_RANGES,
      format: "signedPct",
      description: "median college's undergraduate change, 10 years",
    },
    {
      key: "acceptanceRate",
      label: "Acceptance rate",
      legendLabel: "Median college's acceptance rate",
      values: valuesOf("acceptanceRate"),
      ranges: ACCEPTANCE_RANGES,
      format: "pctWhole",
      description: "median college's acceptance rate",
    },
    {
      key: "avgCost",
      label: "Average cost after inflation",
      legendLabel: "Median college's average total cost",
      values: valuesOf("avgCost"),
      ranges: COST_RANGES,
      format: "moneyK",
      description: "median college's average total cost",
    },
    {
      key: "outOfState",
      label: "Out-of-state first-years",
      legendLabel: "Median public college's out-of-state first-year share",
      values: valuesOf("outOfState"),
      ranges: OOS_RANGES,
      format: "pctWhole",
      description: "median public college's out-of-state first-year share",
    },
    {
      key: "testOptionalShare",
      label: "Share test-optional",
      legendLabel: "Share of colleges that don't require test scores",
      values: valuesOf("testOptionalShare"),
      ranges: TEST_OPTIONAL_RANGES,
      format: "pctWhole",
      description: "of colleges don't require test scores",
    },
  ];

  const rowOf = (s: (typeof file.states)[number]): StatesTableRow => ({
    postal: s.postal,
    name: s.name,
    territory: s.territory,
    onSite: s.onSite.total,
    panel: s.panel.n,
    tooFew: !!s.tooFew,
    undergradChange: s.map.undergradChange,
    acceptanceRate: s.map.acceptanceRate,
    avgCost: s.map.avgCost,
    outOfState: s.map.outOfState,
    testOptionalShare: s.map.testOptionalShare,
  });

  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <Link href="/trends" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> National trends
      </Link>
      <header className="mt-4 mb-8 max-w-3xl sm:mb-10">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">
          <MapIcon className="size-4" /> National trends
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Trends by state</h1>
        <p className="mt-3 text-muted-foreground">
          Most students go to college close to home, and state policy moves whole groups of colleges at once. Pick a measure to color the map, or tap a state for its
          own page. States with fewer than {file.floor} colleges on the site (<Term term="too-few-colleges">too few to say</Term>) show counts only.
        </p>
      </header>

      <section aria-labelledby="map">
        <h2 id="map" className="sr-only">
          Map
        </h2>
        <StateMeasureMap measures={measures} />
      </section>

      <section aria-labelledby="table" className="mt-12">
        <h2 id="table" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Every state and territory
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Sortable; alphabetical by default. <Term term="colleges-or-students">Each college counts once</Term> (the median, not the total).
        </p>
        <div className="mt-5">
          <StatesTable rows={ordered.map(rowOf)} />
        </div>
      </section>

      <section aria-labelledby="method" className="mt-14 max-w-3xl">
        <h2 id="method" className="font-display text-2xl font-extrabold tracking-tight">
          How this was measured
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground marker:text-border">
          <li>
            <b className="text-foreground">Which colleges.</b> Every change is over a <Term term="fixed-panel">fixed panel</Term>: colleges with 300 or more
            undergraduates in both {fall(file.from)} and {fall(file.to)}. A state&apos;s own page says how many of its colleges are in the panel.
          </li>
          <li>
            <b className="text-foreground">{file.floor} colleges, not 30.</b> States are a fixed set readers expect to find, and most have fewer than 30 colleges on
            the site, so the usual 30-college floor relaxes to {file.floor} here.
          </li>
          <li>
            <b className="text-foreground">Today&apos;s classification</b> for public/private and territory status.{" "}
            <Term term="todays-classification">Colleges are grouped as they are today</Term>, not as they were in {fall(file.from)}.
          </li>
          <li>
            <b className="text-foreground">No rankings by quality.</b> The map and table are descriptive; a bigger or smaller change isn&apos;t better or worse, and
            the site doesn&apos;t attribute a state&apos;s change to a policy.
          </li>
        </ul>
        <HistorySourceNote keys={["undergrads", "applicants", "acceptance_rate", "avg_paid_all", "out_of_state_share", "test_policy"]} files={files} className="mt-4" />
      </section>

      <nav aria-label="Related" className="mt-10 flex flex-wrap gap-2">
        <Link href="/trends" className="group inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary">
          All national trends <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </nav>
    </div>
  );
}
