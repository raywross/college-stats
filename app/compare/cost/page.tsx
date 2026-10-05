import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Dataset } from "@/lib/data";
import type { School } from "@/lib/types";
import { METRICS } from "@/lib/metrics";
import { moneyCompact, pct } from "@/lib/format";
import { compareAidRows } from "@/lib/cds/financial-aid-compare";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { compareHref, compareTopicOf, type CompareRow } from "@/lib/compare-topics";
import { compareMetadata, loadComparison, requireComparison } from "@/lib/compare-data";
import { Panel, Block } from "@/components/profile/Panel";
import { CompareTopicPage, COMPARE_BLOCK_SCROLL } from "@/components/compare/CompareTopicPage";
import { CompareMetric } from "@/components/compare/CompareMetric";
import { NetPriceCompare } from "@/components/compare/NetPriceCompare";
import { InfoTip } from "@/components/ui/info-tip";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TOPIC = "cost";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  return compareMetadata(await loadComparison(typeof params.ids === "string" ? params.ids : ""), TOPIC);
}

/** Tuition guarantee and Promise program: "Yes" / "No" / "Not reported", never left blank. */
const GUARANTEE_ROWS: readonly CompareRow[] = [
  [
    "Tuition guarantee",
    "tuition-guarantee",
    "cost.tuition_plans",
    (s: School) => (s.cost?.tuition_plans == null ? "Not reported" : s.cost.tuition_plans.includes("guarantee") ? "Yes" : "No"),
  ],
  [
    "Promise program",
    "promise-program",
    "cost.promise_program",
    (s: School) => (s.cost?.promise_program == null ? "Not reported" : s.cost.promise_program ? "Yes" : "No"),
  ],
];

/**
 * A label column plus one column per college (the sticky-first-column pattern specs/mobile.md gives every Compare
 * table), for a short list of text rows: Tuition guarantee/Promise, and the colleges' own CDS aid rows.
 */
function TextTable({
  rows,
  schools,
  citeField,
  nullLabel = "–",
}: {
  rows: readonly CompareRow[];
  schools: School[];
  citeField: Dataset["citeField"];
  nullLabel?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="sticky left-0 bg-card py-2 pr-4 font-semibold">Metric</th>
            {schools.map((s, i) => (
              <th key={s.unit_id} className="px-3 py-2 font-bold text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                  {shortName(s)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(([label, term, field, fmt]) => (
            <tr key={label}>
              <td className="sticky left-0 bg-card py-2 pr-4 text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  {label} <InfoTip term={term} cited={citeField(field)} />
                </span>
              </td>
              {schools.map((s) => {
                const v = fmt(s);
                return (
                  <td key={s.unit_id} className="px-3 py-2 font-semibold">
                    {v ?? <span className="font-normal text-muted-foreground">{nullLabel}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Cost & aid, compared (specs/compare-redesign.md#topic-pages; specs/data-expansion/cds-financial-aid.md#compare):
 * what students pay, grants, sticker prices on one shared scale, net price by family income, tuition
 * guarantee/Promise, and the colleges' own Common Data Set aid-process rows. A closing link to the full table.
 */
export default async function CompareCostPage({ searchParams }: Props) {
  const params = await searchParams;
  const comparison = await requireComparison(typeof params.ids === "string" ? params.ids : "");
  const { data, schools, ids } = comparison;
  const { citeField } = data;
  const topic = compareTopicOf(TOPIC);

  // CDS financial aid (specs/data-expansion/cds-financial-aid.md): the federal aid year decides which colleges' aid
  // years are shown (cdsAidYearNote, inside compareAidRows); same rows and strings as the table page's Cost & aid group.
  const aidRows = compareAidRows(citeField("aid.cohort").year);
  const hasAidRows = aidRows.some((r) => schools.some((s) => r[3](s) !== null));

  const hasCostData =
    hasAidRows ||
    schools.some(
      (s) =>
        METRICS.avgCost.get(s) !== null ||
        METRICS.aidGenerosity.get(s) !== null ||
        METRICS.netPrice.get(s) !== null ||
        s.cost?.sticker?.in_state != null ||
        s.cost?.sticker?.out_of_state != null ||
        s.cost?.tuition_fees?.in_state != null ||
        s.cost?.tuition_fees?.out_of_state != null ||
        s.cost?.net_price_by_income != null ||
        s.cost?.tuition_plans != null ||
        s.cost?.promise_program != null ||
        s.aid?.grant_pct != null ||
        s.aid?.grant_avg != null ||
        s.aid?.institutional_pct != null
    );

  // Average cost and net price share a scale (both are "what a family effectively pays"); sticker and tuition & fees
  // share a second one, so every bar in a block reads against the others in it, not just against its own card.
  const payMax = Math.max(
    1,
    ...schools.flatMap((s) => [METRICS.avgCost.get(s), METRICS.netPrice.get(s)]).filter((v): v is number => v !== null)
  );
  const stickerMax = Math.max(
    1,
    ...schools
      .flatMap((s) => [s.cost?.sticker?.in_state, s.cost?.sticker?.out_of_state, s.cost?.tuition_fees?.in_state, s.cost?.tuition_fees?.out_of_state])
      .filter((v): v is number => v != null)
  );

  const items = [
    { id: "price", label: "What students pay" },
    { id: "grants", label: "Grants" },
    { id: "sticker", label: "Sticker prices" },
    { id: "by-income", label: "By family income" },
    { id: "guarantee", label: "Tuition guarantee & Promise" },
    { id: "cds", label: "Common Data Sets" },
  ];

  return (
    <CompareTopicPage comparison={comparison} topic={TOPIC} items={hasCostData ? items : []}>
      <Panel level={1} domain={topic.domain} eyebrow={topic.eyebrow} title={topic.label} takeaway={topic.description} fields={[]}>
        {!hasCostData ? (
          <p className="text-muted-foreground">None of these colleges reports cost or financial aid figures.</p>
        ) : (
          <div className="space-y-6">
            <Block id="price" title="What students pay" className={COMPARE_BLOCK_SCROLL}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <CompareMetric
                  label="Average cost, all students"
                  term="average-cost"
                  schools={schools}
                  get={METRICS.avgCost.get}
                  format={moneyCompact}
                  max={payMax}
                  flag={{ which: "min", text: "Lowest" }}
                  cited={citeField("cost.avg_paid_all")}
                />
                <CompareMetric
                  label="Aid generosity"
                  term="aid-generosity"
                  schools={schools}
                  get={METRICS.aidGenerosity.get}
                  format={(v) => pct(v)}
                  max={1}
                  flag={{ which: "max", text: "Most" }}
                  cited={citeField("derived.aid_generosity")}
                />
                <CompareMetric
                  label="Net price, with grants"
                  term="net-price"
                  schools={schools}
                  get={METRICS.netPrice.get}
                  format={moneyCompact}
                  max={payMax}
                  flag={{ which: "min", text: "Lowest" }}
                  cited={citeField("cost.aided_net_price")}
                />
              </div>
            </Block>

            <Block id="grants" title="Grants" className={COMPARE_BLOCK_SCROLL}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <CompareMetric
                  label="First-years receiving grants"
                  term="grant-aid"
                  schools={schools}
                  get={(s) => s.aid?.grant_pct ?? null}
                  format={(v) => pct(v)}
                  max={1}
                  flag={{ which: "max", text: "Most" }}
                  cited={citeField("aid.grant_pct")}
                />
                <CompareMetric
                  label="Average grant"
                  term="grant-aid"
                  schools={schools}
                  get={(s) => s.aid?.grant_avg ?? null}
                  format={moneyCompact}
                  flag={{ which: "max", text: "Largest" }}
                  cited={citeField("aid.grant_avg")}
                />
                <CompareMetric
                  label="Aid from the college"
                  term="institutional-aid"
                  schools={schools}
                  get={(s) => s.aid?.institutional_pct ?? null}
                  format={(v) => pct(v)}
                  max={1}
                  cited={citeField("aid.institutional_pct")}
                />
              </div>
            </Block>

            <Block id="sticker" title="Sticker prices" className={COMPARE_BLOCK_SCROLL}>
              <p className="mb-4 text-xs text-muted-foreground">On one scale, so the bars read against each other.</p>
              <div className="space-y-3">
                <CompareMetric
                  variant="row"
                  label="Sticker price, in-state"
                  term="in-state-tuition"
                  schools={schools}
                  get={(s) => s.cost?.sticker?.in_state ?? null}
                  format={moneyCompact}
                  max={stickerMax}
                  cited={citeField("cost.sticker")}
                />
                <CompareMetric
                  variant="row"
                  label="Sticker price, out-of-state"
                  term="in-state-tuition"
                  schools={schools}
                  get={(s) => s.cost?.sticker?.out_of_state ?? null}
                  format={moneyCompact}
                  max={stickerMax}
                  cited={citeField("cost.sticker")}
                />
                <CompareMetric
                  variant="row"
                  label="Tuition & fees, in-state"
                  term="in-state-tuition"
                  schools={schools}
                  get={(s) => s.cost?.tuition_fees?.in_state ?? null}
                  format={moneyCompact}
                  max={stickerMax}
                  cited={citeField("cost.tuition_fees")}
                />
                <CompareMetric
                  variant="row"
                  label="Tuition & fees, out-of-state"
                  term="in-state-tuition"
                  schools={schools}
                  get={(s) => s.cost?.tuition_fees?.out_of_state ?? null}
                  format={moneyCompact}
                  max={stickerMax}
                  cited={citeField("cost.tuition_fees")}
                />
              </div>
              <div className="mt-4 border-t pt-3">
                <CompareMetric
                  variant="row"
                  label="First-years paying out-of-state rates"
                  term="in-state-tuition"
                  schools={schools}
                  get={(s) => (s.type === "public" ? s.cost?.residency?.out_of_state ?? null : null)}
                  format={(v) => pct(v)}
                  max={1}
                  cited={citeField("cost.residency")}
                />
              </div>
            </Block>

            <div id="by-income" className={COMPARE_BLOCK_SCROLL}>
              <NetPriceCompare schools={schools} year={citeField("cost.net_price_by_income").year} />
            </div>

            <Block id="guarantee" title="Tuition guarantee & Promise program" className={COMPARE_BLOCK_SCROLL}>
              <TextTable rows={GUARANTEE_ROWS} schools={schools} citeField={citeField} nullLabel="Not reported" />
            </Block>

            {hasAidRows && (
              <Block id="cds" title="From the colleges' Common Data Sets" className={COMPARE_BLOCK_SCROLL}>
                <TextTable rows={aidRows} schools={schools} citeField={citeField} />
              </Block>
            )}

            <p className="text-sm">
              <Link href={compareHref(ids, "table", { hash: "cost" })} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                All cost numbers in the table <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </p>
          </div>
        )}
      </Panel>
    </CompareTopicPage>
  );
}
