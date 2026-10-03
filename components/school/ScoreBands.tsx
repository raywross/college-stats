import type { Cited } from "@/lib/lineage";
import type { Bands6, BandTest, ReportedTests } from "@/lib/types";
import { BAND_TEST_LABELS, MIN_SUBMITTERS, bandLabel, bandsCaveat, bandsSentence, oneBandDominates, submitters } from "@/lib/score-bands";
import { MetricLabel } from "@/components/ui/info-tip";
import { ShowMore } from "@/components/ui/show-more";

/**
 * "Score bands" (specs/data-expansion/cds-test-scores-and-policy.md, Display): the share of enrolled first-years who
 * sent each test whose score fell in each band, from the college's Common Data Set C9. One stacked bar per test (SAT
 * total, ACT composite), each band directly labeled, plus a sentence; when one band holds 90% or more, only the
 * sentence. Section and ACT English/Math bands sit behind ShowMore. A test under MIN_SUBMITTERS isn't shown.
 */
export function ScoreBands({
  tests,
  enrolled,
  cited,
  color,
}: {
  tests: ReportedTests;
  /** The class's enrolled count, for share × enrolled when the number submitting isn't reported. */
  enrolled: number | null;
  /** `citeField("reported.tests.bands.<test>", school)` per column. */
  cited: Partial<Record<BandTest, Cited>>;
  color: string;
}) {
  const shown = (test: "SAT" | "ACT") =>
    (submitters(test === "SAT" ? tests.sat_submitters : tests.act_submitters, test === "SAT" ? tests.sat_share : tests.act_share, enrolled) ?? 0) >= MIN_SUBMITTERS;
  const columns = (keys: BandTest[]) => keys.filter((k) => tests.bands[k] && shown(BAND_TEST_LABELS[k].test));
  const main = columns(["sat_composite", "act_composite"]);
  const more = columns(["sat_ebrw", "sat_math", "act_english", "act_math"]);
  if (!main.length && !more.length) return null;
  const tested = [...new Set([...main, ...more].map((k) => BAND_TEST_LABELS[k].test))];

  return (
    <div className="space-y-5">
      {main.map((k) => (
        <BandRow key={k} test={k} bands={tests.bands[k]!} cited={cited[k]} color={color} />
      ))}
      {more.length > 0 && (
        <ShowMore until="lg" label="Show section score bands" hint="SAT sections, ACT English and Math">
          <div className="space-y-5">
            {more.map((k) => (
              <BandRow key={k} test={k} bands={tests.bands[k]!} cited={cited[k]} color={color} small />
            ))}
          </div>
        </ShowMore>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        {tested.map((t) => (
          <p key={t}>{bandsCaveat(t === "SAT" ? tests.sat_share : tests.act_share, t)}</p>
        ))}
      </div>
    </div>
  );
}

function BandRow({ test, bands, cited, color, small }: { test: BandTest; bands: Bands6; cited?: Cited; color: string; small?: boolean }) {
  const { label } = BAND_TEST_LABELS[test];
  // Top band first (left), darkest: one hue, light to dark (a sequential scale).
  const segments = bands.map((v, i) => ({ v, i })).filter((s) => s.v > 0);
  return (
    <div>
      <MetricLabel term="score-bands" cited={cited} className={small ? "text-xs font-semibold" : "text-sm font-semibold"}>
        {label}
      </MetricLabel>
      <p className="mt-1 text-sm text-muted-foreground">{bandsSentence(bands, test)}</p>
      {!oneBandDominates(bands) && (
        <div className="mt-2" role="img" aria-label={`${label} score bands: ${segments.map((s) => `${bandLabel(test, s.i)} ${Math.round(s.v * 100)}%`).join(", ")}`}>
          <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded">
            {segments.map((s) => (
              <div
                key={s.i}
                title={`${bandLabel(test, s.i)}: ${Math.round(s.v * 100)}%`}
                className="h-full first:rounded-l last:rounded-r"
                style={{ width: `${s.v * 100}%`, backgroundColor: `color-mix(in oklch, ${color} ${100 - s.i * 16}%, var(--card))` }}
              />
            ))}
          </div>
          <div className="mt-1 flex w-full gap-[2px] text-[11px] leading-tight text-muted-foreground">
            {segments.map((s) => (
              <span key={s.i} className="min-w-0 overflow-hidden whitespace-nowrap" style={{ width: `${s.v * 100}%` }}>
                {s.v >= 0.12 ? (
                  <>
                    <b className="text-foreground tabular-nums">{Math.round(s.v * 100)}%</b> {bandLabel(test, s.i)}
                  </>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
