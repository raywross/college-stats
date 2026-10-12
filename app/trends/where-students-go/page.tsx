import type { Metadata } from "next";
import Link from "next/link";
import { getHistoryFiles, getTrendFile } from "@/lib/data";
import { money, pct, points } from "@/lib/format";
import { historyYearLabel } from "@/lib/history";
import { stateName } from "@/lib/states";
import { studyBySlug } from "@/lib/trend-studies";
import type { GroupingKey } from "@/lib/trend-groups";
import type { GroupingResult, WhereStudentsGoValues } from "@/lib/trends";
import { Sparkline } from "@/components/charts/Sparkline";
import { StateTileMap, type TileRange } from "@/components/charts/StateTileMap";
import { TrendLine } from "@/components/charts/TrendLine";
import { GroupBars, type GroupBarsView } from "@/components/trends/GroupBars";
import { StudyPage } from "@/components/trends/StudyPage";
import { TrendStat } from "@/components/trends/TrendStat";
import { CollegesStudents } from "@/components/trends/ViewSwitch";
import { ApplicationLines } from "@/components/trends/where-students-go/ApplicationLines";
import { KindBars } from "@/components/trends/where-students-go/KindBars";
import { PeriodsByGroup } from "@/components/trends/where-students-go/PeriodsByGroup";
import { PriceFifths } from "@/components/trends/where-students-go/PriceFifths";
import { Term } from "@/components/ui/info-tip";

const study = studyBySlug("where-students-go")!;

export const metadata: Metadata = { title: study.title, description: study.question };

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const COLOR = study.color;
const THEN_COLOR = "var(--muted-foreground)";

/** The page's grouping order (spec section 3): size with the 20,000+ split, research tier, public or private, region, setting, selectivity. */
const PAGE_GROUPINGS: readonly GroupingKey[] = ["size4", "research", "control", "region", "setting", "selectivity"];
/** Groupings classified as of the window's first fall (the builder's `byGroupThen`). */
const CLASSIFIED_THEN: readonly GroupingKey[] = ["size4", "size", "selectivity"];

/** Change in a state's share of campus-based undergraduates, in share units (0.004 = 0.4 points). */
const STATE_RANGES: TileRange[] = [
  { lo: -Infinity, hi: -0.004, label: "Lost 0.4+ pts", bg: "var(--div-1)", ink: "text-white dark:text-background" },
  { lo: -0.004, hi: -0.001, label: "Lost 0.1–0.4", bg: "var(--div-2)", ink: "text-foreground" },
  { lo: -0.001, hi: 0.001, label: "Within 0.1", bg: "var(--div-3)", ink: "text-foreground" },
  { lo: 0.001, hi: 0.004, label: "Gained 0.1–0.4", bg: "var(--div-4)", ink: "text-foreground" },
  { lo: 0.004, hi: Infinity, label: "Gained 0.4+ pts", bg: "var(--div-5)", ink: "text-white dark:text-background" },
];

const signedPct = (v: number, digits = 0) => {
  const r = Math.round(v * 10 ** (digits + 2)) / 10 ** (digits + 2);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${pct(Math.abs(r), digits)}`;
};
const pts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
const tileValue = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(1)}`;

/** "faster than" / "about as fast as" / "slower than": a pace (points a year) against another, by magnitude. */
function paceWord(pace: number, against: number): string {
  if (Math.abs(Math.abs(pace) - Math.abs(against)) < 0.05) return "about as fast as";
  return Math.abs(pace) > Math.abs(against) ? "faster than" : "slower than";
}

function row(groupings: readonly GroupingResult<WhereStudentsGoValues>[], grouping: GroupingKey, key: string): WhereStudentsGoValues | null {
  return groupings.find((g) => g.grouping === grouping)?.groups.find((r) => r.key === key)?.values ?? null;
}

/**
 * Study 7 (specs/trends/where-students-go.md): each kind of college's share of campus-based undergraduates, then and
 * now, and the pandemic as three periods inside the ten years. Every number and year comes from
 * data/history/trends/where-students-go.json; only the sentences are written here.
 */
export default async function WhereStudentsGoPage() {
  const [file, files] = await Promise.all([getTrendFile("where-students-go"), getHistoryFiles()]);
  if (!file || !file.national.values) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const { from, to, prePandemicFall: pre, lowFall: low, cost, applications } = file;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const year = (y: number) => historyYearLabel(y, "academic");
  const provisional = files?.meta.provisional.adm ?? null;

  const xl = row(file.groupings, "size4", "xl");
  const r1 = row(file.groupings, "research", "R1");
  const notResearch = row(file.groupings, "research", "other");
  const midwest = row(file.groupings, "region", "Midwest");
  const west = row(file.groupings, "region", "West");
  const town = row(file.groupings, "setting", "town");
  const mostSelective = row(file.groupings, "selectivity", "most");
  const publicRow = row(file.groupings, "control", "public");
  const privateRow = row(file.groupings, "control", "private-nonprofit");
  const city = row(file.groupings, "setting", "city");
  if (!xl || !r1) {
    return <StudyPage study={study} file={null} headline={null} national={null} breakdowns={null} takeaway={null} />;
  }
  const period = (v: WhereStudentsGoValues, key: "before" | "pandemic" | "after") => v.periods.find((p) => p.key === key)!;
  const afterLen = to - low;
  const sizeRows = (file.groupings.find((g) => g.grouping === "size4")?.groups ?? []).filter((r) => r.key !== "xl" && r.values);
  const pandemicLosses = sizeRows.map((r) => period(r.values!, "pandemic").studentsChange);
  const rose = xl.line.slice(1).filter((v, i) => v !== null && xl.line[i] !== null && v > xl.line[i]!).length;
  const kinds = Object.fromEntries(file.byKind.map((k) => [k.key, k]));
  const excluded = file.byKind.filter((k) => k.key !== "campus-based");
  const nowIdx = file.campusBased.indexToPrePandemic;
  const lowIdx = nowIdx[low - from] ?? 0;
  const toIdx = nowIdx[to - from] ?? 0;
  const recovered = lowIdx < 0 ? (toIdx - lowIdx) / -lowIdx : 0;

  // States: the biggest gainers and losers of national share.
  const statesByPoints = [...file.states].sort((a, b) => b.points - a.points || a.postal.localeCompare(b.postal));
  const gainers = statesByPoints.slice(0, 3);
  const losers = statesByPoints.slice(-3).reverse();
  const stateValues = Object.fromEntries(file.states.map((s) => [s.postal, s.points]));
  const stateByPostal = new Map(file.states.map((s) => [s.postal, s]));

  // Applications: R1 universities' share at each fall, and where it peaked.
  const appR1 = applications.byGrouping.find((g) => g.grouping === "research")?.groups.find((g) => g.key === "R1") ?? null;
  const appPublic = applications.byGrouping.find((g) => g.grouping === "control")?.groups.find((g) => g.key === "public") ?? null;
  const appPeak = appR1 ? appR1.shares.indexOf(Math.max(...appR1.shares)) : -1;

  // Cost: the fifth that cut price most and the one that raised it most, all colleges; the priciest fifth by level.
  const changeAll = cost.byChange.find((c) => c.control === "all")?.fifths ?? [];
  const levelAll = cost.byLevel.find((c) => c.control === "all")?.fifths ?? [];
  const cutMost = changeAll[0];
  const raised = changeAll[changeAll.length - 1];
  const priciest = levelAll[levelAll.length - 1];
  const rho = (period: string, control: string) => cost.correlations.find((c) => c.period === period && c.control === control);
  const decade = rho("decade", "all");
  const within = (["before", "pandemic", "after"] as const).map((p) => rho(p, "all")?.rho ?? 0);
  const publicLine = cost.students.find((s) => s.control === "public")?.line ?? [];
  const privateLine = cost.students.find((s) => s.control === "private-nonprofit")?.line ?? [];
  const pandemicYear = pre + 1; // the first pandemic school year, as an academic year (the price series runs one behind the falls)
  const pubAt = (y: number) => publicLine[y - cost.fromMoney] ?? null;
  const privAt = (y: number) => privateLine[y - cost.fromMoney] ?? null;
  /** True when most of a line's fall over the decade came after the first pandemic school year. */
  const fellLate = (at: (y: number) => number | null) => {
    const [a, mid, b] = [at(cost.fromMoney), at(pandemicYear), at(cost.toMoney)];
    return a !== null && mid !== null && b !== null && a > b && (mid - b) / (a - b) > 0.5;
  };
  const priceStory = fellLate(pubAt) && fellLate(privAt);
  const priceLink = decade && decade.rho > 0.1 && within.every((r) => Math.abs(r) < decade.rho);

  const xlPan = period(xl, "pandemic");
  const r1Pan = period(r1, "pandemic");
  const kept = xlPan.pacePerYear > 0 && r1Pan.pacePerYear > 0;
  const slowed = Math.abs(period(xl, "after").pacePerYear) < Math.abs(period(xl, "before").pacePerYear) && Math.abs(period(r1, "after").pacePerYear) < Math.abs(period(r1, "before").pacePerYear);

  const shareShiftView: GroupBarsView = {
    key: "students",
    label: "Students",
    caption: `Each group's share of all campus-based undergraduates, ${fall(from)} and ${fall(to)}. Size and selectivity as of ${fall(from)}.`,
    format: "pct",
    legend: [
      { name: historyYearLabel(from, "fall"), color: THEN_COLOR },
      { name: historyYearLabel(to, "fall"), color: COLOR },
    ],
    domain: Math.max(...PAGE_GROUPINGS.flatMap((g) => (file.groupings.find((x) => x.grouping === g)?.groups ?? []).flatMap((r) => r.values?.share ?? [0]))) * 1.05,
    groupings: PAGE_GROUPINGS.map((key) => file.groupings.find((g) => g.grouping === key)!)
      .filter(Boolean)
      .map((g) => ({
        key: g.grouping,
        label: CLASSIFIED_THEN.includes(g.grouping) ? `${g.label} (${fall(from)})` : g.label,
        floor: g.floor,
        rows: g.groups.map((r) =>
          r.tooFew || !r.values
            ? { key: r.key, label: r.label, n: r.n, tooFew: true }
            : {
                key: r.key,
                label: r.label,
                n: r.n,
                bars: [
                  { name: historyYearLabel(from, "fall"), value: r.values.share[0], color: THEN_COLOR },
                  { name: historyYearLabel(to, "fall"), value: r.values.share[1], color: COLOR },
                ],
                summary: `${pct(r.values.share[0], 1)} → ${pct(r.values.share[1], 1)} (${points(r.values.points)}) · students ${signedPct(r.values.totalChange)}`,
              }
        ),
      })),
  };

  const periodGroupings = PAGE_GROUPINGS.map((key) => file.groupings.find((g) => g.grouping === key)!)
    .filter(Boolean)
    .map((g) => ({
      key: g.grouping,
      label: g.label,
      groups: g.groups
        .filter((r) => r.values)
        .map((r) => ({
          key: r.key,
          label: r.label,
          n: r.n,
          line: r.values!.line,
          back: r.values!.backToPrePandemic,
          periods: r.values!.periods.map((p) => ({ key: p.key, from: p.from, to: p.to, pace: p.pacePerYear, studentsChange: p.studentsChange, medianChange: p.medianChange, grewShare: p.grewShare })),
        })),
    }));

  const mdAfter = midwest ? period(midwest, "after") : null;
  const mdBefore = midwest ? period(midwest, "before") : null;
  const townAfter = town ? period(town, "after") : null;
  const townBefore = town ? period(town, "before") : null;

  return (
    <StudyPage
      study={study}
      file={file}
      headline={
        <>
          <TrendStat
            label={
              <>
                Campus-based <Term term="undergrad-enrollment">undergraduates</Term> at colleges with 20,000+ students
              </>
            }
            values={xl.share}
            format="pct"
            from={from}
            to={to}
            kind="fall"
            counts="share of students"
            color={COLOR}
          />
          <TrendStat label={<>At research universities (R1)</>} values={r1.share} format="pct" from={from} to={to} kind="fall" counts="share of students" color={COLOR} />
          <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
            <figcaption className="text-sm font-semibold">Share at 20,000+ campuses, each fall</figcaption>
            <div className="mt-4">
              <Sparkline
                series={[{ name: "At 20,000+ campuses", color: COLOR, values: xl.line }]}
                start={from}
                kind="fall"
                format="pct"
                label={`Share of campus-based undergraduates at colleges with 20,000 or more students in ${fall(from)}, each fall from ${fall(from)} to ${fall(to)}`}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Up in {rose} of {xl.line.length - 1} falls, pandemic included.
            </p>
          </figure>
        </>
      }
      nationalIntro={
        <>
          Every college with 300 or more undergraduates in both {fall(from)} and {fall(to)}, by kind, as a share of all their students. The rest of this page is{" "}
          <b>campus-based</b> colleges only: an <Term term="online-first">online-first</Term> college&apos;s enrollment can grow without anyone moving anywhere, and a
          merger moves students between records; either would swamp the picture.
        </>
      }
      national={
        <div className="rounded-3xl border bg-card p-4 sm:p-5">
          <KindBars
            thenLabel={historyYearLabel(from, "fall")}
            nowLabel={historyYearLabel(to, "fall")}
            segments={file.byKind.map((k, i) => ({
              key: k.key,
              label: k.label,
              n: k.n,
              share: k.share,
              color: ["var(--d-size)", "var(--demo-1)", "var(--demo-4)", "var(--muted-foreground)"][i] ?? "var(--muted-foreground)",
            }))}
          />
          {kinds["online-first"] && kinds["campus-based"] && (
            <p className="mt-4 text-sm text-muted-foreground">
              Online-first public and nonprofit colleges went from {pct(kinds["online-first"].share[0], 1)} to {pct(kinds["online-first"].share[1], 1)} of these students (
              {signedPct(kinds["online-first"].totalChange)} in students), while campus-based colleges went from {pct(kinds["campus-based"].share[0], 1)} to{" "}
              {pct(kinds["campus-based"].share[1], 1)} ({signedPct(kinds["campus-based"].totalChange, 1)}).
            </p>
          )}
        </div>
      }
      breakdownsIntro={
        <>
          Each group&apos;s share of all {file.n.toLocaleString("en-US")} campus-based colleges&apos; undergraduates, then and now, on one scale: the{" "}
          <Term term="colleges-or-students">students</Term> view. For how many <i>colleges</i> shrank or grew, see{" "}
          <Link href="/trends/shrinking-colleges" className="font-semibold text-primary hover:underline">
            Shrinking colleges
          </Link>
          .
        </>
      }
      breakdowns={<GroupBars views={[shareShiftView]} />}
      takeaway={
        <>
          <p>
            <b>Students concentrated, steadily.</b> The share of campus-based undergraduates at colleges with 20,000 or more students (as of {fall(from)}) went
            from {pct(xl.share[0], 1)} to {pct(xl.share[1], 1)}, up in {rose} of {xl.line.length - 1} falls, and research universities (R1) went from{" "}
            {pct(r1.share[0], 1)} to {pct(r1.share[1], 1)}
            {notResearch && (
              <>
                {" "}
                while colleges outside the research tiers lost {pct(Math.abs(notResearch.totalChange))} of their students
              </>
            )}
            . These overlap: the biggest campuses are mostly research universities in cities{city ? <> (city campuses went from {pct(city.share[0])} to {pct(city.share[1])})</> : null}, so they are one shift seen from several sides, not
            separate findings.
          </p>
          <p>
            <b>{kept ? "The pandemic didn't interrupt the concentration." : "The pandemic changed the pace."}</b> From {fall(pre)} to {fall(low)}, colleges that had
            20,000+ students changed by {signedPct(xlPan.studentsChange, 1)} in students
            {pandemicLosses.length > 0 && Math.max(...pandemicLosses) < 0 && (
              <>
                {" "}
                while every other size lost between {pct(Math.abs(Math.max(...pandemicLosses)), 1)} and {pct(Math.abs(Math.min(...pandemicLosses)), 1)}
              </>
            )}
            ; their share moved {pts(xlPan.pacePerYear)} points a year, {paceWord(xlPan.pacePerYear, period(xl, "before").pacePerYear)} the{" "}
            {pts(period(xl, "before").pacePerYear)} before it, and R1 universities&apos; {pts(r1Pan.pacePerYear)},{" "}
            {paceWord(r1Pan.pacePerYear, period(r1, "before").pacePerYear)} the {pts(period(r1, "before").pacePerYear)} before.
            {publicRow && privateRow && (
              <>
                {" "}
                Public colleges&apos; students changed {signedPct(period(publicRow, "pandemic").studentsChange, 1)} in those falls and private nonprofits&apos;{" "}
                {signedPct(period(privateRow, "pandemic").studentsChange, 1)}.
              </>
            )}
          </p>
          <p>
            <b>{slowed ? <>Since {fall(low)}, the shifts have slowed, so far.</> : <>Since {fall(low)}, so far.</>}</b> The after period is {afterLen}{" "}
            {afterLen === 1 ? "fall" : "falls"} long, too short to call a reversal.
            {lowIdx < 0 && <> The campus-based total has regained about {pct(recovered)} of what it lost.</>} The recovery is where the growth was: {pct(xl.backToPrePandemic)} of 20,000+ campuses and{" "}
            {pct(r1.backToPrePandemic)} of R1 universities are back at their {fall(pre)} size
            {notResearch && <>, against {pct(notResearch.backToPrePandemic)} of colleges outside the research tiers</>}.
            {mdAfter && mdBefore && townAfter && townBefore && (
              <>
                {" "}
                Some lines flattened: the Midwest&apos;s share changed {pts(mdBefore.pacePerYear)} points a year before the pandemic and {pts(mdAfter.pacePerYear)}{" "}
                since; town campuses&apos; {pts(townBefore.pacePerYear)} and {pts(townAfter.pacePerYear)}. That is a slower loss or a flat line, not a recovery.
              </>
            )}
            {west && mostSelective && (
              <>
                {" "}
                The West&apos;s share is changing {pts(period(west, "after").pacePerYear)} points a year since {fall(low)} after {pts(period(west, "before").pacePerYear)}{" "}
                before, and the most selective colleges&apos; {pts(period(mostSelective, "after").pacePerYear)} after {pts(period(mostSelective, "before").pacePerYear)}.
              </>
            )}
          </p>
          {appR1 && appPeak >= 0 && (
            <p>
              <b>Applications moved differently.</b> R1 universities&apos; share of all applications went {appR1.shares.map((s) => pct(s, 1)).join(" → ")} at{" "}
              {applications.falls.map((y) => fall(y)).join(", ")}
              {appPeak < appR1.shares.length - 1 ? <>: it peaked in {fall(applications.falls[appPeak])} and has eased since</> : null}
              {appPublic && (
                <>
                  ; public colleges&apos; went from {pct(appPublic.shares[0], 1)} to {pct(appPublic.shares[appPublic.shares.length - 1], 1)}
                </>
              )}
              .
            </p>
          )}
          {cutMost && raised && priciest && (
            <p>
              <b>Price moved with enrollment, not against it.</b> The fifth of colleges that cut what students pay the most, after inflation, lost{" "}
              {pct(Math.abs(cutMost.totalChange))} of their students; the fifth that held or raised it {cutMost.totalChange < raised.totalChange ? "did better" : "did no better"} (
              {signedPct(raised.totalChange)}), and the priciest fifth at the start {priciest.totalChange >= 0 ? "grew" : "shrank"} ({signedPct(priciest.totalChange)}).
              Colleges losing students discounted more; this doesn&apos;t say which came first.
            </p>
          )}
          <p className="text-muted-foreground">
            Where students went also follows where 18-year-olds live: high-school classes grew in the South and West and shrank in the Midwest, and these data
            can&apos;t separate a change in appetite from a change in population. Breakdowns show where the change happened, not why.
          </p>
        </>
      }
      method={[
        <>
          <b className="text-foreground">Campus-based.</b> {file.allN.toLocaleString("en-US")} colleges have {file.minUndergrads.toLocaleString("en-US")}+ undergraduates
          in both falls; {excluded.map((k) => `${k.n.toLocaleString("en-US")} ${k.key === "online-first" ? "online-first" : k.key === "for-profit" ? "for-profit" : "merged or split"}`).join(", ")}{" "}
          are left out, leaving {file.n.toLocaleString("en-US")}. <Term term="online-first">Online-first</Term> means more than half of undergraduates took every
          course online at either end of the window ({fall(from)} or {fall(to)}; the pandemic falls read the fall before, and a college that reported no share that
          fall counts as campus-based). Merged or split campuses are the reviewed list the Movers page uses.
        </>,
        <>
          <b className="text-foreground">Classified then.</b> Size and selectivity use each college&apos;s {fall(from)} value, because the question is where students
          went <i>from</i> the kinds of college that existed then; region, public or private, setting, and research tier use today&apos;s classification. Classified by
          today&apos;s size instead, the 20,000+ share reads {pct(file.todayClassified.xlShare[0], 1)} → {pct(file.todayClassified.xlShare[1], 1)}, which overstates the
          shift by counting colleges that grew past 20,000 as large at both ends.
        </>,
        <>
          <b className="text-foreground">Three periods.</b> Before ({fall(from)} to {fall(pre)}, the last fall before the pandemic), the pandemic ({fall(pre)} to{" "}
          {fall(low)}, the fall with the fewest campus-based undergraduates since, found from the data each release), and after ({fall(low)} to {fall(to)}: {afterLen}{" "}
          {afterLen === 1 ? "fall" : "falls"} so far). Pace is the change in a group&apos;s share in <Term term="percentage-points">points</Term> per year, so periods of
          different lengths compare.
        </>,
        <>
          <b className="text-foreground">Shares by fall</b> use the colleges reporting that fall, and a fall is left out when under 90% of the panel reports.
          Colleges that closed aren&apos;t in a <Term term="fixed-panel">fixed panel</Term>, so the decline at small colleges is understated.
        </>,
        <>
          <b className="text-foreground">Applications</b> cover the {applications.n.toLocaleString("en-US")} campus-based colleges reporting applicants in every one of{" "}
          {applications.falls.map((y) => fall(y)).join(", ")} (the period boundaries; a fall under 90% coverage would be replaced by the nearest earlier one).
        </>,
        <>
          <b className="text-foreground">Money</b> is <Term term="average-cost">average cost paid</Term>, <Term term="inflation-adjusted">after inflation</Term> in{" "}
          {year(cost.toMoney)} dollars, for {cost.n.toLocaleString("en-US")} campus-based colleges reporting it in both {year(cost.fromMoney)} and {year(cost.toMoney)}.
          Price years run one behind the falls. Fifths hold equal numbers of colleges.
        </>,
      ]}
      links={[
        { href: "/trends/shrinking-colleges", label: "Shrinking colleges (the colleges view)" },
        { href: "/trends/price-gap", label: "The price gap" },
        { href: "/trends/states", label: "By state" },
        { href: "/trends/movers", label: "Biggest movers: grew the most" },
      ]}
    >
      <section aria-labelledby="concentration" className="min-w-0">
        <h2 id="concentration" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          The biggest campuses&apos; share
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Share of campus-based undergraduates at the 50 and the 100 biggest campuses, re-ranked each fall:{" "}
          {pct(file.concentration.top100[0] ?? 0, 1)} → {pct(file.concentration.top100[file.concentration.top100.length - 1] ?? 0, 1)} for the 100 biggest.
        </p>
        <div className="mt-5 rounded-3xl border bg-card p-4 sm:p-5">
          <TrendLine
            series={[
              { key: "top100", name: "100 biggest", color: COLOR, start: from, values: file.concentration.top100 },
              { key: "top50", name: "50 biggest", color: "var(--demo-1)", start: from, values: file.concentration.top50 },
            ]}
            from={from}
            to={to}
            kind="fall"
            format="pct"
            spans={[{ from: pre + 1, to: low, label: "Pandemic" }]}
            label={`Share of campus-based undergraduates at the 50 and 100 biggest campuses, ${fall(from)} to ${fall(to)}`}
          />
        </div>
      </section>

      <section aria-labelledby="pandemic" className="min-w-0">
        <h2 id="pandemic" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          What the pandemic did, and what came after
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Campus-based undergraduates against {fall(pre)}: {signedPct(lowIdx, 1)} at the low in {fall(low)}, {signedPct(toIdx, 1)} in {fall(to)}. Then each group&apos;s share
          by fall, and how fast it moved before, during, and after.
        </p>
        <div className="mt-5 space-y-4">
          <div className="rounded-3xl border bg-card p-4 sm:p-5">
            <TrendLine
              series={[{ key: "index", name: `Against ${fall(pre)}`, color: COLOR, start: from, values: file.campusBased.indexToPrePandemic }]}
              from={from}
              to={to}
              kind="fall"
              format="pct"
              spans={[{ from: pre + 1, to: low, label: "Pandemic" }]}
              provisionalYear={provisional}
              label={`Campus-based undergraduates each fall against ${fall(pre)}, ${fall(from)} to ${fall(to)}`}
            />
          </div>
          <PeriodsByGroup groupings={periodGroupings} from={from} to={to} pre={pre} low={low} />
        </div>
      </section>

      <section aria-labelledby="states" className="min-w-0">
        <h2 id="states" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          By state
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          The change in each state&apos;s share of campus-based undergraduates, {fall(from)} to {fall(to)}, in points (states with {file.stateFloor}+ panel colleges).
          Gaining the most: {gainers.map((s) => `${stateName(s.postal)} (${points(s.points)})`).join(", ")}; losing the most:{" "}
          {losers.map((s) => `${stateName(s.postal)} (${points(s.points)})`).join(", ")}.
        </p>
        <div className="mt-5 rounded-3xl border bg-card p-4 sm:p-5">
          <StateTileMap
            values={stateValues}
            ranges={STATE_RANGES}
            legendLabel="Change in share of students, points"
            format={tileValue}
            href={(s) => `/trends/states/${s.toLowerCase()}`}
            valueTitle={(s, v) => {
              const st = stateByPostal.get(s);
              return `${stateName(s)}: ${points(v)} of campus-based undergraduates; ${st ? `${signedPct(st.totalChange)} students` : ""}. Click for the state page`;
            }}
            emptyTitle={(s) => `${stateName(s)}: fewer than ${file.stateFloor} campus-based colleges in the panel`}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            This follows where high-school graduates live: the Sun Belt&apos;s classes grew and the Midwest&apos;s shrank, and these data can&apos;t separate that from
            a change in where students choose to go. Each state&apos;s page shows its own colleges, and where its first-years come from and go to:{" "}
            {[...gainers.slice(0, 1), ...losers.slice(0, 1)].map((s, i) => (
              <span key={s.postal}>
                {i > 0 && " and "}
                <Link href={`/trends/states/${s.postal.toLowerCase()}#flows`} className="font-semibold text-primary hover:underline">
                  {stateName(s.postal)}
                </Link>
              </span>
            ))}
            , for example.
          </p>
        </div>
      </section>

      <section aria-labelledby="applications" className="min-w-0">
        <h2 id="applications" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Applications spread, enrollment concentrated
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Each group&apos;s share of all <Term term="applicants">applications</Term> to {applications.n.toLocaleString("en-US")} campus-based colleges, at{" "}
          {applications.falls.map((y) => fall(y)).join(", ")}: where the applications went
          {appR1 && appPeak >= 0 && appPeak < appR1.shares.length - 1 ? <>, and R1 universities&apos; share peaking in {fall(applications.falls[appPeak])}</> : null}.
        </p>
        <div className="mt-5">
          <ApplicationLines
            falls={applications.falls}
            panels={applications.byGrouping.map((g) => ({
              key: g.grouping,
              label: g.grouping === "size4" ? `Size (${fall(from)})` : g.grouping === "research" ? "Research tier" : "Public or private",
              groups: g.groups.map((x) => ({ key: x.key, label: x.label, shares: x.shares })),
            }))}
          />
        </div>
      </section>

      <section aria-labelledby="price" className="min-w-0">
        <h2 id="price" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Price moved with enrollment
        </h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          {cost.n.toLocaleString("en-US")} campus-based colleges, in fifths by the change in their <Term term="average-cost">average cost paid</Term>{" "}
          <Term term="inflation-adjusted">after inflation</Term> from {year(cost.fromMoney)} to {year(cost.toMoney)}, and by that price at the start. Each bar is
          the fifth&apos;s change in undergraduates, {fall(from)} to {fall(to)}.
          {decade && priceLink && (
            <>
              {" "}
              Across the decade a college&apos;s price change and its enrollment change move together (rank correlation {decade.rho.toFixed(2)}), but within any one
              period the link is weak ({within.map((r) => r.toFixed(2)).join(", ")} before, during, and after the pandemic): colleges discounted while they shrank,
              over years, not as a year-to-year response. The <Link href="/trends/price-gap" className="font-semibold text-primary hover:underline">price gap</Link>{" "}
              study sees the same thing from the price side.
            </>
          )}
        </p>
        <div className="mt-5">
          <CollegesStudents
            colleges={
              <>
                <p className="mb-3 text-sm text-muted-foreground">Colleges view: each college counts once in its fifth; bars show the fifth&apos;s total change in students.</p>
                <PriceFifths
                  panels={[
                    { key: "change", title: `By the change in price after inflation, ${year(cost.fromMoney)} to ${year(cost.toMoney)}`, kind: "change", byControl: cost.byChange },
                    { key: "level", title: `By price at the start, in ${year(cost.toMoney)} dollars`, kind: "level", byControl: cost.byLevel },
                  ]}
                />
              </>
            }
            students={
              <div className="rounded-3xl border bg-card p-4 sm:p-5">
                <p className="text-sm font-semibold">What the average student paid, after inflation ({year(cost.toMoney)} dollars)</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Students view: each college weighted by its undergraduates.
                  {priceStory && (
                    <>
                      {" "}
                      At publics, {money(pubAt(cost.fromMoney) ?? 0)} in {year(cost.fromMoney)}, {money(pubAt(pandemicYear)!)} in {year(pandemicYear)}, and{" "}
                      {money(pubAt(cost.toMoney)!)} in {year(cost.toMoney)}; at private nonprofits {money(privAt(cost.fromMoney) ?? 0)},{" "}
                      {money(privAt(pandemicYear)!)}, and {money(privAt(cost.toMoney)!)}. Most of the decade&apos;s fall came after {year(pandemicYear)}, when inflation
                      outran prices.
                    </>
                  )}
                </p>
                <div className="mt-4">
                  <TrendLine
                    series={[
                      { key: "public", name: "Public", color: "var(--demo-1)", start: cost.fromMoney, values: publicLine },
                      { key: "private", name: "Private nonprofit", color: "var(--demo-2)", start: cost.fromMoney, values: privateLine },
                    ]}
                    from={cost.fromMoney}
                    to={cost.toMoney}
                    kind="academic"
                    format="money"
                    spans={[{ from: pre, to: low - 1, label: "Pandemic" }]}
                    label={`Enrollment-weighted average cost paid after inflation, public and private nonprofit, ${year(cost.fromMoney)} to ${year(cost.toMoney)}`}
                  />
                </div>
              </div>
            }
          />
        </div>
      </section>
    </StudyPage>
  );
}
