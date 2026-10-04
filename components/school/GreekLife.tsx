import { Home, Users } from "lucide-react";
import { getData } from "@/lib/data";
import { pctSmart } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { fratMedian, greekCard, greekReporters, sorMedian } from "@/lib/cds/greek-display";
import type { School } from "@/lib/types";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * Greek life, phase 1 (specs/greek-life.md): fraternity and sorority participation among undergraduates, each
 * benchmarked against the median of colleges that report it, and the F4 housing checkbox. Returns null without any
 * F1 percentage or F4 answer; the card never shows "0%" for a college that simply didn't answer.
 */
export async function GreekLife({ school }: { school: School }) {
  const { citeField, getAllSchools } = await getData();
  const card = greekCard(school);
  if (!card) return null;
  const color = DOMAINS.size.color;
  const reporters = greekReporters(getAllSchools());
  const fratMed = fratMedian(reporters);
  const sorMed = sorMedian(reporters);

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-5 flex items-center gap-1.5 font-display text-lg font-bold">
        Greek life <InfoTip term="greek-life" />
      </h3>
      {(card.frat || card.sor) && (
        <div className="grid gap-6 sm:grid-cols-2">
          {card.frat?.undergrad != null && (
            <BenchmarkBar
              label="Undergrad men in a fraternity"
              term="greek-life"
              cited={citeField("reported.greek.frat_pct_undergrad", school)}
              value={card.frat.undergrad}
              median={fratMed ?? undefined}
              scale={[0, 1]}
              format={pctSmart}
              color={color}
            />
          )}
          {card.sor?.undergrad != null && (
            <BenchmarkBar
              label="Undergrad women in a sorority"
              term="greek-life"
              cited={citeField("reported.greek.sor_pct_undergrad", school)}
              value={card.sor.undergrad}
              median={sorMed ?? undefined}
              scale={[0, 1]}
              format={pctSmart}
              color={color}
            />
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Reported for {reporters.length} colleges. First-years and all undergrads are reported separately, and a fraternity percentage is never added to a sorority one.
      </p>
      {(card.frat?.firstYear != null || card.sor?.firstYear != null) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="size-3.5" />
          Among first-years:{" "}
          {[
            card.frat?.firstYear != null && `${pctSmart(card.frat.firstYear)} of men`,
            card.sor?.firstYear != null && `${pctSmart(card.sor.firstYear)} of women`,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      )}
      {card.housing && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
          <Home className="size-4" style={{ color }} />
          Fraternity/sorority housing offered
          <InfoTip term="greek-life" cited={citeField("reported.greek.housing", school)} />
        </p>
      )}
    </div>
  );
}
