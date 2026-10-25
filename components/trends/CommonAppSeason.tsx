import { getCommonAppTrends } from "@/lib/data";
import { citationFor, newestSeason, rowFor, type CommonAppTrendRow, type CommonAppTrendsFile } from "@/lib/common-app/trends";
import { num } from "@/lib/format";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/** One figure in the season grid: a cited value, with its growth caption when the measure has one. */
function SeasonTile({ label, term, row, file, value, growth, className }: { label: string; term?: Parameters<typeof Term>[0]["term"]; row: CommonAppTrendRow; file: CommonAppTrendsFile; value: string; growth?: string; className?: string }) {
  return (
    <div className={cn("rounded-3xl border bg-card p-4 sm:p-5", className)}>
      <MetricLabel term={term} cited={citationFor(row, file)} className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </MetricLabel>
      <p className="mt-1 font-display text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">{value}</p>
      {growth && <p className="mt-1 text-sm text-muted-foreground">{growth}</p>}
    </div>
  );
}

/**
 * "This season on the Common App" (specs/data-expansion/common-app.md "National and state figures";
 * common-app-build/brief.md "U5"), rendered on /trends after the Studies grid: the newest season's applicants,
 * applications per applicant, member institutions, and the growth figures as stat tiles, each cited to the report
 * that stated it. Renders nothing without data/trends/common-app.json (like the other entry sections).
 */
export async function CommonAppSeason() {
  const file = await getCommonAppTrends();
  if (!file) return null;
  const season = newestSeason(file);
  if (!season) return null;

  const applicants = rowFor(file, season, "applicants");
  const perApplicant = rowFor(file, season, "applications_per_applicant");
  const members = rowFor(file, season, "members");
  const applicantsGrowth = rowFor(file, season, "applicants_growth");
  const feeWaiverGrowth = rowFor(file, season, "fee_waiver_eligible_growth");
  const firstGenGrowth = rowFor(file, season, "first_generation_growth");

  // Every stat tile needs its own row; without the core three there's nothing worth a section for.
  if (!applicants || !perApplicant || !members) return null;

  const seasonLabel = season.replace("-", "–");

  return (
    <section aria-labelledby="common-app-season">
      <h2 id="common-app-season" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        This season on the Common App
      </h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        A head start on the {seasonLabel} season, straight from the platform most applicants use, months before federal
        data catches up.
      </p>
      <div className="mt-5 grid gap-4 max-sm:gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SeasonTile
          label="First-year applicants"
          row={applicants}
          file={file}
          value={num(applicants.value)}
          growth={applicantsGrowth ? `${applicantsGrowth.value > 0 ? "+" : ""}${applicantsGrowth.value}% from last season` : undefined}
        />
        <SeasonTile label="Applications per applicant" row={perApplicant} file={file} value={perApplicant.value.toFixed(2)} />
        <SeasonTile label="Member institutions" row={members} file={file} value={num(members.value)} />
        {feeWaiverGrowth && (
          <SeasonTile
            label="Growth, fee-waiver-eligible applicants"
            term="fee-waiver"
            row={feeWaiverGrowth}
            file={file}
            value={`${feeWaiverGrowth.value > 0 ? "+" : ""}${feeWaiverGrowth.value}%`}
            growth="from last season"
          />
        )}
        {firstGenGrowth && (
          <SeasonTile
            label="Growth, first-generation applicants"
            term="first-gen"
            row={firstGenGrowth}
            file={file}
            value={`${firstGenGrowth.value > 0 ? "+" : ""}${firstGenGrowth.value}%`}
            growth="from last season"
          />
        )}
      </div>
      <p className="mt-4 max-w-3xl text-xs text-muted-foreground">
        Common App&apos;s own count of its members&apos; first-year applicants, reported each August; the figures are Common
        App&apos;s, not federal data. State figures to come.
      </p>
    </section>
  );
}
