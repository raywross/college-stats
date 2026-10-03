import type { School } from "@/lib/types";
import { getData } from "@/lib/data";
import { money, moneyCompact, num, pct } from "@/lib/format";
import { hasGraduateDebt } from "@/lib/cds/cost-and-debt";
import { Block } from "@/components/profile/Panel";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";

/**
 * Graduates' total debt (specs/data-expansion/cds-cost-and-debt.md): the federal median debt (federal loans only)
 * with, directly under it, the college's own CDS H4–H5 line for its newest graduating class, all loan types. Two
 * different measures, each named by its scope, never reconciled into one figure. Renders nothing without the CDS line.
 */
export async function GraduateDebt({ school, id }: { school: School; id?: string }) {
  const { citeField } = await getData();
  if (!hasGraduateDebt(school)) return null;
  const debt = school.reported!.outcomes!.graduate_debt!;
  const any = debt.rows.any;
  const size = school.reported?.outcomes?.graduating_class?.size ?? null;
  const median = school.outcomes?.median_debt ?? null;
  const classLabel = citeField("reported.outcomes.graduating_class", school).year;

  return (
    <Block id={id} className="mt-4 space-y-3">
      <h3 className="font-display text-lg font-bold">What graduates owe</h3>
      {median !== null && (
        <div>
          <MetricLabel term="median-debt" cited={citeField("outcomes.median_debt", school)} className="text-xs font-semibold text-muted-foreground">
            Median debt at graduation, federal loans only
          </MetricLabel>
          <p className="font-display text-2xl font-extrabold">{moneyCompact(median)}</p>
        </div>
      )}
      <p className="max-w-3xl text-sm leading-relaxed">
        According to {school.name}&apos;s most recent Common Data Set,{" "}
        {any.share !== null ? (
          <>
            <b>{pct(any.share, any.share < 0.1 ? 1 : 0)}</b>
            <InfoTip term="cumulative-principal" cited={citeField("reported.outcomes.graduate_debt.rows.any.share", school)} className="mx-0.5 align-middle" /> of its{" "}
            {classLabel ? `${classLabel} ` : ""}graduates{size !== null ? ` (${num(size)} students)` : ""} borrowed from any source: federal, institutional, state, or private
            {any.avg_principal !== null && (
              <>
                , averaging <b>{money(any.avg_principal)}</b>
                <InfoTip term="cumulative-principal" cited={citeField("reported.outcomes.graduate_debt.rows.any.avg_principal", school)} className="mx-0.5 align-middle" /> among
                those who did
              </>
            )}
          </>
        ) : (
          <>
            its {classLabel ? `${classLabel} ` : ""}graduates who borrowed from any source (federal, institutional, state, or private) took out an average of{" "}
            <b>{money(any.avg_principal!)}</b>
            <InfoTip term="cumulative-principal" cited={citeField("reported.outcomes.graduate_debt.rows.any.avg_principal", school)} className="mx-0.5 align-middle" />
          </>
        )}
        .
      </p>
      <p className="text-xs text-muted-foreground">
        Counts students who started here as first-time students and earned a bachelor&apos;s; the federal median counts federal loans only, including students who left without a degree.
      </p>
    </Block>
  );
}
