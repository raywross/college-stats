import type { Metadata } from "next";
import { Calculator, ExternalLink } from "lucide-react";
import { requireTopic } from "@/lib/profile-data";
import { TOPIC_FIELDS, topicHref } from "@/lib/profile-topics";
import { DOMAINS } from "@/lib/metrics";
import { costTakeaway } from "@/lib/insights";
import { money, moneyCompact } from "@/lib/format";
import { hasLoanData } from "@/lib/repayment";
import { hasTuitionGuarantee } from "@/lib/housing";
import { BLOCK_SCROLL, Panel, Block } from "@/components/profile/Panel";
import { TopicPage, topicMetadata } from "@/components/profile/TopicPage";
import { HeadlineDelta } from "@/components/history/HeadlineDelta";
import { ShowMore } from "@/components/ui/show-more";
import { InfoTip, MetricLabel, Term } from "@/components/ui/info-tip";
import { NetPriceByIncome } from "@/components/charts/NetPriceByIncome";
import { AidBreakdown } from "@/components/charts/AidBreakdown";
import { WhatStudentsPay } from "@/components/school/WhatStudentsPay";
import { LoansCard } from "@/components/school/LoansCard";
import { AidGenerosityCard } from "@/components/school/AidGenerosityCard";
import { NextYearPrice } from "@/components/school/NextYearPrice";
import { ApplyingForAid } from "@/components/school/ApplyingForAid";
import { InternationalAid } from "@/components/school/InternationalAid";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return topicMetadata((await params).id, "cost");
}

// Rendered on first visit and kept for a day (specs/profile-redesign.md#routes); publishes revalidate sooner.
export const revalidate = 86400;
// An empty list makes Next render each college's page on first visit and keep it (ISR); without it the route is
// dynamic on every request (node_modules/next/dist/docs: generateStaticParams, "All paths at runtime").
export async function generateStaticParams() {
  return [];
}

const TOPIC = "cost";

/** What students pay, price by family income, debt and payback, borrowing and repayment, who gets aid. */
export default async function CostPage({ params }: Props) {
  const { id } = await params;
  const p = await requireTopic(id, TOPIC);
  const { data, school, history, byIncome, payback, avgCost, detail } = p;
  const { citeField } = data;
  const c = school.cost;
  const o = school.outcomes;
  const byIncomeYear = citeField("cost.net_price_by_income", school).year;
  // Net price by income covers in-state students at publics, so the full-price column uses the in-state sticker.
  const stickerFull = c?.sticker?.in_state ?? c?.sticker?.in_district ?? null;
  const stickerCited = citeField("cost.sticker", school);
  const stickerYear = stickerCited.year ?? stickerCited.inputs?.[0]?.year ?? null;

  const items = [
    { id: "price", label: "What students pay" },
    { id: "by-income", label: "Price by family income" },
    { id: "debt", label: "Debt and payback" },
    { id: "loans", label: "Borrowing and repayment" },
    { id: "aid", label: "Who gets aid" },
    // CDS financial aid (specs/data-expansion/cds-financial-aid.md): only when the college's CDS record has them.
    ...(school.reported?.aid ? [{ id: "apply-for-aid", label: "Applying for aid" }] : []),
    ...(school.reported?.aid?.international || detail?.tables.cds_aid?.rows.h7 ? [{ id: "international-aid", label: "International students" }] : []),
  ];

  return (
    <TopicPage profile={p} topic={TOPIC} items={items}>
      <Panel
        level={1}
        domain="value"
        eyebrow="Cost & aid"
        title="What it costs"
        takeaway={costTakeaway(data, school)}
        delta={history && <HeadlineDelta seriesKey="avg_paid_all" history={history.history} files={history.files} color={DOMAINS.value.color} href={topicHref(school.unit_id, "history")} />}
        school={school}
        fields={TOPIC_FIELDS[TOPIC]}
      >
        {(school.links?.price_calculator || school.links?.financial_aid || school.links?.veterans) && (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
            {school.links?.price_calculator && (
              <a
                href={school.links.price_calculator}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-1 items-center gap-3 rounded-2xl border border-dashed p-4 transition-colors hover:border-primary/40"
              >
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-pop text-pop-foreground">
                  <Calculator className="size-5" />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <b>Your family&apos;s price will differ.</b>{" "}
                  <span className="text-muted-foreground">
                    Get a personal estimate from {school.name}&apos;s official <Term term="net-price-calculator">net price calculator</Term>.
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </a>
            )}
            {(school.links?.financial_aid || school.links?.veterans) && (
              <div className="flex flex-col justify-center gap-2 rounded-2xl border border-dashed p-4 text-sm sm:w-60 sm:shrink-0">
                {school.links?.financial_aid && (
                  <a href={school.links.financial_aid} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-1.5 font-semibold text-primary">
                    <span className="group-hover:underline">Financial aid office</span>
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                )}
                {school.links?.veterans && (
                  <a href={school.links.veterans} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-1.5 font-semibold text-primary">
                    <span className="group-hover:underline">Veterans&apos; benefits</span>
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                )}
              </div>
            )}
          </div>
        )}
        {(avgCost !== null || c?.sticker) && (
          <div id="price" className={BLOCK_SCROLL}>
            <WhatStudentsPay school={school} />
          </div>
        )}
        <NextYearPrice school={school} />
        {(hasTuitionGuarantee(school) || c?.promise_program) && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {hasTuitionGuarantee(school) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 font-semibold">
                Tuition guarantee <InfoTip term="tuition-guarantee" cited={citeField("cost.tuition_plans", school)} />
              </span>
            )}
            {c?.promise_program && (
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 font-semibold">
                Part of a Promise program <InfoTip term="promise-program" cited={citeField("cost.promise_program", school)} />
              </span>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Block id="by-income">
            <h3 className="mb-1 flex items-center gap-1 font-display text-lg font-bold">
              What families at each income level pay <InfoTip term="net-price-by-income" cited={citeField("cost.net_price_by_income", school)} />
            </h3>
            <p className="mb-5 text-xs text-muted-foreground">
              Average price after grants per year for students receiving federal aid
              {byIncomeYear ? `, ${byIncomeYear}` : ""}.
              {stickerFull !== null && <> Students with no grants pay the full {school.type === "public" ? "in-state " : ""}sticker price.</>}
            </p>
            {byIncome ? (
              <NetPriceByIncome values={byIncome} sticker={stickerFull} years={{ netPrice: byIncomeYear, sticker: stickerYear }} />
            ) : (
              <p className="text-sm text-muted-foreground">Net price by family income isn&apos;t reported.</p>
            )}
          </Block>
          <div className="flex flex-col gap-4">
            {(o?.median_debt != null || payback !== null) && (
              <Block id="debt" className="grid grid-cols-2 gap-4">
                {o?.median_debt != null && (
                  <div>
                    <MetricLabel term="median-debt" cited={citeField("outcomes.median_debt", school)} className="text-xs font-semibold text-muted-foreground">
                      Median debt at graduation
                    </MetricLabel>
                    <p className="mt-2 font-display text-3xl font-extrabold">{moneyCompact(o.median_debt)}</p>
                    {o.monthly_loan_payment != null && <p className="text-xs text-muted-foreground">≈ {money(o.monthly_loan_payment)}/month for 10 years</p>}
                  </div>
                )}
                {payback !== null && (
                  <div>
                    <MetricLabel term="payback" cited={citeField("derived.payback_years", school)} className="text-xs font-semibold text-muted-foreground">
                      Payback estimate
                    </MetricLabel>
                    <p className="mt-2 font-display text-3xl font-extrabold">{payback.toFixed(1)} yrs</p>
                    <p className="text-xs text-muted-foreground">of median salary to cover 4 years of net price</p>
                  </div>
                )}
              </Block>
            )}
          </div>
        </div>

        {hasLoanData(school) && (
          <ShowMore id="loans" until="lg" label="Show borrowing and repayment" hint="Who takes federal loans, debt by background, and how repayment is going" className="mt-4">
            <LoansCard school={school} />
          </ShowMore>
        )}

        {school.aid && (
          <div id="aid" className={`mt-10 ${BLOCK_SCROLL}`}>
            <h3 className="mb-3 font-display text-xl font-extrabold tracking-tight sm:text-2xl lg:mb-1">Who actually gets aid</h3>
            <p className="mb-4 hidden max-w-3xl text-muted-foreground lg:block">
              Some colleges cover most of their price with grants; others cover little. Here&apos;s how generous this one is, how many students get grants, where the money
              comes from, and how it varies with family income.
            </p>
            <ShowMore until="lg" label="Show who gets aid" hint="How generous grants are, who gets them, where aid comes from, and aid by family income">
              <div className="space-y-4">
                <AidGenerosityCard school={school} />
                <AidBreakdown school={school} detail={detail} />
              </div>
            </ShowMore>
          </div>
        )}
        <ApplyingForAid school={school} detail={detail} />
        <InternationalAid school={school} detail={detail} />
      </Panel>
    </TopicPage>
  );
}
