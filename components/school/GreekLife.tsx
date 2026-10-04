import { Home, Users } from "lucide-react";
import { getData } from "@/lib/data";
import { pctSmart } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { fratMedian, greekCard, greekParticipationBlankOrZero, greekReporters, sorMedian } from "@/lib/cds/greek-display";
import { groupListings, latestDirectoryRead, listingsFor } from "@/lib/directories";
import type { SchoolDetail } from "@/lib/detail";
import type { School } from "@/lib/types";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { InfoTip } from "@/components/ui/info-tip";
import { CreditedList } from "./CreditedList";

/**
 * Greek life (specs/greek-life.md phases 1 and 4): the college's own CDS F1/F4 numbers (fraternity/sorority
 * participation, housing) plus national organizations' chapter directories, grouped by council with each
 * council's chapter count visible and its chapter names in an expandable list (open question 2: "council totals
 * over chapter tables"). The two sources are shown together because they answer different questions: F1 is the
 * only number comparable across colleges, but it only covers NPC/NIC-style participation; directories can show
 * NPHC, Latino, Asian, multicultural, and LGBTQ+ chapters a CDS percentage never mentions.
 *
 * Status rule (phase 4 "none found" vs. "none reported"): a college with neither a CDS answer nor any directory
 * listing gets "No fraternity or sorority chapters found in national directories (month, year)" — never "none" —
 * and only once at least one directory sweep has actually run (`latestDirectoryRead`); before that, or whenever
 * either source has something, this returns null or the normal cards.
 */
export async function GreekLife({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const { citeField, getAllSchools } = await getData();
  const card = greekCard(school);
  const listings = listingsFor(detail?.tables.directories?.rows, "greek");
  const groups = groupListings(listings);

  if (!card && !groups.length) {
    if (!greekParticipationBlankOrZero(school)) return null;
    const checked = latestDirectoryRead(getAllSchools());
    if (!checked) return null;
    return (
      <div className="rounded-3xl border bg-card p-4 sm:p-6">
        <h3 className="mb-2 flex items-center gap-1.5 font-display text-lg font-bold">
          Greek life <InfoTip term="greek-life" />
        </h3>
        <p className="text-sm text-muted-foreground">No fraternity or sorority chapters found in national directories ({checked}).</p>
      </div>
    );
  }

  const color = DOMAINS.size.color;
  const reporters = greekReporters(getAllSchools());
  const fratMed = fratMedian(reporters);
  const sorMed = sorMedian(reporters);

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-5 flex items-center gap-1.5 font-display text-lg font-bold">
        Greek life <InfoTip term="greek-life" />
      </h3>
      {card && (card.frat || card.sor) && (
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
      {card && (card.frat || card.sor) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Reported for {reporters.length} colleges. First-years and all undergrads are reported separately, and a fraternity percentage is never added to a sorority one.
        </p>
      )}
      {card && (card.frat?.firstYear != null || card.sor?.firstYear != null) && (
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
      {card?.housing && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
          <Home className="size-4" style={{ color }} />
          Fraternity/sorority housing offered
          <InfoTip term="greek-life" cited={citeField("reported.greek.housing", school)} />
        </p>
      )}

      {groups.length > 0 && (
        <div className={card ? "mt-6 border-t pt-5" : undefined}>
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Users className="size-4" style={{ color }} />
            Chapters by council <InfoTip term="national-directory" />
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map((g) => (
              <details key={g.key} className="group">
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 py-1 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-medium group-open:font-semibold">{g.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {g.listings.length} chapter{g.listings.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <div className="mt-1.5 pb-1">
                  <CreditedList items={g.listings} />
                </div>
              </details>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">From each organization&apos;s own chapter list, not confirmed by the college; see each chapter&apos;s ⓘ for the source and date read.</p>
        </div>
      )}
    </div>
  );
}
