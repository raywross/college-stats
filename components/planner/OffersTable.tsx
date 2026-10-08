"use client";

import { useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import { CollegeChip } from "@/components/planner/CollegeChip";
import { OfferSheet } from "@/components/planner/OfferControls";
import { SlopeChart, type SlopeRow } from "@/components/charts/SlopeChart";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import type { TermKey } from "@/lib/glossary";
import type { AnyCited } from "@/lib/lineage";
import { SLOT_COLORS } from "@/lib/brand";
import { formatMiles } from "@/lib/home";
import { OFFER_SORTS, awardYearLabel, sortOffers, usd, type CfpView, type FallbackCoa, type FourYears, type OfferDraft, type OfferFacts, type OfferSortKey } from "@/lib/planner/offers";
import type { PlanSchool } from "@/lib/planner/types";

/** One admitted college as the table shows it (built on the server by OffersStage; serializable). */
export interface OfferColumn {
  itemId: string;
  unitId: string;
  school: Pick<PlanSchool, "unit_id" | "name" | "brand">;
  position: number;
  dream: boolean;
  offerId: string | null;
  awardYear: number;
  draft: OfferDraft | null;
  view: CfpView | null;
  four: FourYears | null;
  facts: OfferFacts | null;
  distanceMiles: number | null;
  visitRating: number | null;
  canEdit: boolean;
}

const cited = (c: unknown) => (c ?? undefined) as AnyCited | undefined;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function value(c: OfferColumn, key: OfferSortKey): number | null {
  switch (key) {
    case "list":
      return c.position;
    case "coa":
      return c.view?.coa.total ?? null;
    case "gift":
      return c.view ? c.view.gifts.total : null;
    case "net":
      return c.view?.netCost ?? c.facts?.avgCost ?? null;
    case "borrowing":
      return c.view ? c.view.loans.headline : null;
    case "four_year":
      return c.four?.totals.net ?? null;
    case "monthly":
      return c.four ? (c.four.student?.monthly ?? 0) : null;
    case "earnings":
      return c.facts?.earnings ?? null;
    case "grad_rate":
      return c.facts?.gradRate ?? null;
    case "distance":
      return c.distanceMiles;
    case "visit":
      return c.visitRating;
  }
}

interface Line {
  key: string;
  label: ReactNode;
  cell: (c: OfferColumn) => ReactNode;
}

function Money({ v }: { v: number | null | undefined }) {
  return <span className="tabular-nums">{typeof v === "number" ? usd(v) : "—"}</span>;
}

function label(text: string, term?: TermKey) {
  return term ? <Term term={term}>{text}</Term> : text;
}

const LINES: Line[] = [
  {
    key: "coa",
    label: label("Cost of attendance", "cost-of-attendance"),
    cell: (c) =>
      c.view ? (
        c.view.coa.source === "ipeds" ? (
          <MetricLabel cited={cited(c.facts?.fullPriceCite)}>
            <span>
              <Money v={c.view.coa.total} />
              <span className="block text-[11px] text-muted-foreground">cost added from IPEDS{c.view.coa.year ? `, ${c.view.coa.year}` : ""}: the letter didn&apos;t state it</span>
            </span>
          </MetricLabel>
        ) : (
          <Money v={c.view.coa.total} />
        )
      ) : null,
  },
  { key: "gift", label: label("Gift aid", "gift-aid"), cell: (c) => (c.view ? <Money v={c.view.gifts.total} /> : null) },
  { key: "net", label: label("Net cost", "net-cost"), cell: (c) => (c.view ? <strong><Money v={c.view.netCost} /></strong> : null) },
  { key: "work", label: label("Work-study, if earned", "work-study"), cell: (c) => (c.view ? <Money v={c.view.workStudy} /> : null) },
  { key: "oop", label: "Out of pocket", cell: (c) => (c.view ? <Money v={c.view.outOfPocket} /> : null) },
  { key: "borrow", label: "Student loans offered", cell: (c) => (c.view ? <Money v={c.view.loans.headline} /> : null) },
  {
    key: "notaid",
    label: (
      <>
        <Term term="parent-plus">Parent PLUS</Term> and private: not aid
      </>
    ),
    cell: (c) => (c.view ? <Money v={c.view.loans.notAid} /> : null),
  },
  {
    key: "four",
    label: "Four-year net cost",
    cell: (c) =>
      c.four ? (
        <span>
          <Money v={c.four.totals.net} />
          {c.four.bothWays && (
            <span className="block text-[11px] text-muted-foreground">
              <Money v={c.four.totals.netIfNotRenewed} /> if the awards with no <Term term="renewable-award">renewal</Term> terms stop after year 1
            </span>
          )}
        </span>
      ) : null,
  },
  {
    key: "monthly",
    label: "Monthly payment, 10-year standard plan",
    cell: (c) =>
      c.four ? (
        c.four.student ? (
          <span>
            <Money v={c.four.student.monthly} />
            <span className="block text-[11px] text-muted-foreground">
              on {usd(c.four.student.principal)} of student loans at {(c.four.student.rate * 100).toFixed(2)}%
              {c.four.student.exact ? "" : ` (the ${awardYearLabel(c.four.student.rateYear)} rate, the newest published)`}
              {c.four.student.tier ? `; the ${c.four.student.tier.plan.toLowerCase()} plan runs ${c.four.student.tier.years} years: ${usd(c.four.student.tier.monthly)} a month` : ""}
            </span>
          </span>
        ) : (
          "No student loans"
        )
      ) : null,
  },
  {
    key: "avg",
    label: label("Published average cost", "average-cost"),
    cell: (c) => (c.facts?.avgCost != null ? <MetricLabel cited={cited(c.facts.avgCostCite)}><Money v={c.facts.avgCost} /></MetricLabel> : "Not reported"),
  },
  {
    key: "generosity",
    label: label("Aid generosity", "aid-generosity"),
    cell: (c) => (c.facts?.generosity ? <MetricLabel cited={cited(c.facts.generosity.cite)}><span>{c.facts.generosity.label}</span></MetricLabel> : "Not reported"),
  },
  {
    key: "earnings",
    label: label("Median earnings, 10 years after entry", "median-earnings"),
    cell: (c) => (c.facts?.earnings != null ? <MetricLabel cited={cited(c.facts.earningsCite)}><Money v={c.facts.earnings} /></MetricLabel> : "Not reported"),
  },
  {
    key: "debt",
    label: label("Median debt at graduation", "median-debt"),
    cell: (c) => (c.facts?.debt != null ? <MetricLabel cited={cited(c.facts.debtCite)}><Money v={c.facts.debt} /></MetricLabel> : "Not reported"),
  },
  {
    key: "grad",
    label: label("Graduation rate", "graduation-rate"),
    cell: (c) => (c.facts?.gradRate != null ? <MetricLabel cited={cited(c.facts.gradRateCite)}><span>{pct(c.facts.gradRate)}</span></MetricLabel> : "Not reported"),
  },
  { key: "distance", label: "Distance from home", cell: (c) => (c.distanceMiles !== null ? formatMiles(c.distanceMiles) : "—") },
  { key: "visit", label: "Your visit rating", cell: (c) => (c.visitRating !== null ? `${c.visitRating} of 5` : "No visit rated") },
];

/**
 * The offers side by side (specs/planner/offers.md "Comparing the admits"): one column per admitted college, the
 * family's numbers in the College Financing Plan's order and the college's published context below (each cited).
 * Sortable by any line, and the sort is named; nothing is ranked. Admits without an offer show the published average
 * cost and "Add the offer". A slope view of each offer's net cost from year 1 to year 4 (specs/charts.md SlopeChart).
 * Phones: cards in a swipe rail; from `sm` the table, scrolling sideways inside its own wrapper.
 */
export function OffersTable({ columns, fallbacks }: { columns: OfferColumn[]; fallbacks: Record<string, FallbackCoa | null> }) {
  const [sort, setSort] = useState<OfferSortKey>("list");
  const sorted = sortOffers(columns, sort, value);
  const spec = OFFER_SORTS.find((s) => s.key === sort)!;
  const withNet = sorted.filter((c) => c.four && c.four.years[0].net !== null && c.four.years[3].net !== null);
  const slope: SlopeRow[] = withNet.map((c, i) => ({
    id: c.itemId,
    name: c.school.name,
    color: i < SLOT_COLORS.length ? SLOT_COLORS[i] : "var(--muted-foreground)",
    from: c.four!.years[0].net!,
    to: c.four!.years[3].net!,
  }));

  const action = (c: OfferColumn) =>
    c.canEdit ? (
      <OfferSheet itemId={c.itemId} unitId={c.unitId} collegeName={c.school.name} awardYear={c.awardYear} initial={c.draft} offerId={c.offerId} fallback={fallbacks[c.unitId] ?? null} primary={!c.offerId} />
    ) : null;

  return (
    <div className="space-y-4">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Sorted by</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as OfferSortKey)} className="min-h-11 rounded-full border bg-background px-3 text-sm sm:min-h-9">
          {OFFER_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="sr-only" aria-live="polite">
          Sorted by {spec.label}
        </span>
      </label>

      {/* Phones: one card per college in a swipe rail. */}
      <ul className="grid gap-3 sm:hidden max-sm:rail max-sm:[--rail-item:86%]" aria-label={`Offers, sorted by ${spec.label.toLowerCase()}`}>
        {sorted.map((c) => (
          <li key={c.itemId} className="space-y-2 rounded-2xl border bg-background p-3">
            <Head c={c} />
            {c.view ? (
              <dl className="space-y-1.5 text-sm">
                {LINES.map((l) => (
                  <div key={l.key} className="flex items-start justify-between gap-3">
                    <dt className="min-w-0 text-xs text-muted-foreground">{l.label}</dt>
                    <dd className="text-right">{l.cell(c)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <NoOffer c={c} />
            )}
            {action(c)}
          </li>
        ))}
      </ul>

      {/* From sm: the table, scrolling sideways inside its wrapper. */}
      <div className="relative hidden overflow-x-auto rounded-2xl border sm:block">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">Offers side by side, sorted by {spec.label.toLowerCase()}</caption>
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="sticky left-0 z-10 bg-card p-2 text-left text-xs font-semibold text-muted-foreground">
                Per year unless it says four years
              </th>
              {sorted.map((c) => (
                <th key={c.itemId} scope="col" className="min-w-44 p-2 text-left align-top">
                  <Head c={c} />
                  <div className="mt-1.5">{action(c)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINES.map((l) => (
              <tr key={l.key} className="border-b last:border-0">
                <th scope="row" className="sticky left-0 z-10 max-w-56 bg-card p-2 text-left text-xs font-semibold text-muted-foreground">
                  {l.label}
                </th>
                {sorted.map((c) => (
                  <td key={c.itemId} className="p-2 align-top">
                    {c.view || ["avg", "generosity", "earnings", "debt", "grad", "distance", "visit"].includes(l.key) ? l.cell(c) : l.key === "coa" ? <span className="text-xs text-muted-foreground">No offer yet</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {slope.length > 0 && (
        <figure className="space-y-2">
          <figcaption className="text-sm font-semibold">
            <Term term="net-cost">Net cost</Term>, year 1 to year 4
            <span className="block text-xs font-normal text-muted-foreground">
              Each offer&apos;s yearly net cost as costs rise at the college&apos;s own recent rate and awards renew as the letter says (unknown renewals counted as
              renewing; the table shows the other way).
            </span>
          </figcaption>
          <SlopeChart rows={slope} fromLabel="Year 1" toLabel="Year 4" format="money" label="Net cost per offer, year 1 and year 4" />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {slope.map((r) => (
              <li key={r.id} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                {r.name}: {usd(r.from)} → {usd(r.to)}
              </li>
            ))}
          </ul>
        </figure>
      )}
    </div>
  );
}

function Head({ c }: { c: OfferColumn }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <CollegeChip school={c.school} link />
      {c.dream && <Star className="size-4 shrink-0 fill-current text-primary" aria-label="Dream" />}
    </div>
  );
}

function NoOffer({ c }: { c: OfferColumn }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground">No offer yet.</p>
      {c.facts?.avgCost != null && (
        <p>
          <MetricLabel term="average-cost" cited={cited(c.facts.avgCostCite)}>
            <span>
              Published average cost <strong className="tabular-nums">{usd(c.facts.avgCost)}</strong>
            </span>
          </MetricLabel>
        </p>
      )}
    </div>
  );
}

