import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Trophy } from "lucide-react";
import { getData, getHistoryFiles, getTrendFile } from "@/lib/data";
import { CONFERENCE_LEVELS, conferenceName } from "@/lib/conferences";
import { historyYearLabel } from "@/lib/history";
import type { School } from "@/lib/types";
import { Sparkline } from "@/components/charts/Sparkline";
import { ConferenceTable, type ConferenceTableGroup } from "@/components/trends/conferences/ConferenceTable";
import { allMoves } from "@/components/trends/conferences/moves";
import { PowerFour, PowerFourNote } from "@/components/trends/conferences/PowerFour";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { Term } from "@/components/ui/info-tip";

export const metadata: Metadata = {
  title: "Trends by athletic conference",
  description: "How each athletic conference's member colleges compare and changed: admissions, cost, size, and where students come from, the Power 4 side by side, and who joined or left.",
};

// Publishes regenerate this page on demand (/api/revalidate); this daily pass is a fallback if that call is missed.
export const revalidate = 86400;

const short = (code: number) => (conferenceName(code) ?? String(code)).replace(/^The /, "");

/**
 * /trends/conferences (specs/trends/conferences.md): the Power 4 side by side, every conference by level (sortable),
 * and this year's realignment. Every number and year comes from data/history/trends/conferences.json.
 */
export default async function ConferencesPage() {
  const [file, files, data] = await Promise.all([getTrendFile("conferences"), getHistoryFiles(), getData()]);

  if (!file || !files) {
    return (
      <Shell>
        <div className="rounded-3xl border border-dashed p-6 text-muted-foreground sm:p-8">
          <p className="font-semibold text-foreground">Conference trends aren&apos;t available yet.</p>
          <p className="mt-1 text-sm">They&apos;re computed from the site&apos;s year-by-year history, and appear once that data is published.</p>
          <Link href="/trends" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
            All national trends <ArrowRight className="size-4" />
          </Link>
        </div>
      </Shell>
    );
  }

  const apps = file.measures.find((m) => m.key === "applicants")!;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const arYear = file.glance.find((g) => g.key === "acceptance_rate")?.year;
  const costYear = file.glance.find((g) => g.key === "avg_paid_all")?.year;
  const groups: ConferenceTableGroup[] = CONFERENCE_LEVELS.map(({ level, label }) => ({
    level,
    label,
    rows: file.conferences
      .filter((c) => c.level === level)
      .map((c) => ({
        code: c.code,
        slug: c.slug,
        name: c.name,
        members: c.members.length,
        ...(c.footballOnly ? { footballOnly: c.footballMembers?.length ?? 0 } : {}),
        tooFew: !!c.tooFew,
        acceptance: c.glance?.acceptance_rate?.median ?? null,
        cost: c.glance?.avg_paid_all?.median ?? null,
        appsChange: c.change?.applicants ?? null,
      })),
  })).filter((g) => g.rows.length);

  const newest = file.membership.to;
  const moves = allMoves(file).filter((m) => m.year === newest && !m.football);
  const schools = new Map<string, School>(data.getSchoolsByIds(moves.map((m) => m.unit_id)).map((s) => [s.unit_id, s]));
  const perYear = file.movesPerYear;
  const peak = perYear.reduce((a, b) => (b.moves > a.moves ? b : a), perYear[0]);
  const summarized = file.conferences.filter((c) => !c.tooFew).length;

  return (
    <Shell>
      <div className="space-y-14 sm:space-y-20">
        <section aria-labelledby="power-four">
          <h2 id="power-four" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            The Power 4, side by side
          </h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            The four largest football conferences&apos; member colleges: how selective, how costly, and how big the median member is, and how much its
            applications grew from {fall(apps.from)} to {fall(apps.to)}.
          </p>
          <div className="mt-5">
            <PowerFour file={file} />
            <PowerFourNote file={file} />
          </div>
        </section>

        <section aria-labelledby="all">
          <h2 id="all" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Every conference
          </h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            {file.conferences.length} conferences with a member on the site, by level, A to Z; tap a column to sort. {summarized} have {file.floor} or more
            members, enough for a <Term term="median">median</Term>. Acceptance rate is {arYear ? fall(arYear) : "the newest fall"}, average cost{" "}
            {costYear ? historyYearLabel(costYear, "academic") : "the newest year"}, and applications the median member&apos;s change from {fall(apps.from)} to{" "}
            {fall(apps.to)}.
          </p>
          <div className="mt-5">
            <ConferenceTable
              groups={groups}
              floor={file.floor}
              caption="Athletic conferences by level with their members' medians"
              appsLabel={`Applications, ${apps.from}–${String(apps.to).slice(2)}`}
            />
          </div>
          {file.unaffiliated.length > 0 && (
            <div className="mt-5 max-w-3xl rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
              <b className="text-foreground">No conference.</b> Independents and catch-all codes aren&apos;t leagues, so they&apos;re left out of the
              medians:{" "}
              {file.unaffiliated.map((u, i) => (
                <span key={u.code}>
                  {u.name} ({u.members}){i < file.unaffiliated.length - 1 ? ", " : "."}
                </span>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="realignment">
          <h2 id="realignment" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Realignment in {historyYearLabel(newest, "academic")}
          </h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-[3fr_2fr]">
            <div className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
              {moves.length ? (
                <ul className="space-y-1.5 text-sm">
                  {moves.map((m) => (
                    <li key={`${m.unit_id}-${m.to}`}>
                      <Link href={`/schools/${m.unit_id}`} className="font-semibold hover:text-primary hover:underline">
                        {schools.get(m.unit_id)?.name ?? m.unit_id}
                      </Link>
                      <span className="text-muted-foreground">
                        : {short(m.from)} → {short(m.to)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No conference moves this year among the site&apos;s colleges.</p>
              )}
            </div>
            {perYear.length > 1 && (
              <figure className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
                <figcaption className="text-sm font-semibold">Conference moves per year</figcaption>
                <div className="mt-3">
                  <Sparkline
                    series={[{ name: "Moves", color: "var(--primary)", values: perYear.map((p) => p.moves) }]}
                    start={perYear[0].year}
                    kind="academic"
                    format="int"
                    label={`Conference moves per school year, ${historyYearLabel(perYear[0].year, "academic")} to ${historyYearLabel(perYear[perYear.length - 1].year, "academic")}`}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {Math.min(...perYear.map((p) => p.moves))}–{peak.moves} a year since {historyYearLabel(perYear[0].year, "academic")}, the most in {historyYearLabel(peak.year, "academic")}.
                  Football-only moves aren&apos;t counted.
                </p>
              </figure>
            )}
          </div>
        </section>

        <section aria-labelledby="method" className="max-w-3xl">
          <h2 id="method" className="font-display text-2xl font-extrabold tracking-tight">
            How this was measured
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground marker:text-border">
            <li>
              <b className="text-foreground">Members.</b> Each college&apos;s main <Term term="athletic-conference">athletic conference</Term> as it reports it to
              the federal survey today; a college playing football elsewhere counts under its main conference. Medians are over{" "}
              <Term term="conference-membership">today&apos;s members</Term> unless a chart says otherwise.
            </li>
            <li>
              <b className="text-foreground">Medians, not rankings.</b> A conference needs {file.floor} members on the site for a median, and a year&apos;s median
              needs {Math.round(file.coverage * 100)}% of members reporting. Football-only conferences are listed without medians.
            </li>
            <li>
              <b className="text-foreground">Moves.</b> A change in a college&apos;s reported conference from one year to the next; a change undone within two
              years is treated as a reporting slip.
            </li>
            <li>
              <b className="text-foreground">The universe.</b> The site&apos;s four-year colleges, not every member of each conference. The numbers show how members
              compare and changed, not why.
            </li>
          </ul>
          <HistorySourceNote
            className="mt-4"
            keys={["conference", "applicants", "acceptance_rate", "avg_paid_all", "undergrads"]}
            files={files}
            range={[Math.min(...file.measures.map((m) => m.from)), file.membership.to]}
          />
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <Link href="/trends" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> National trends
      </Link>
      <header className="mt-4 mb-8 max-w-3xl sm:mb-10">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">
          <Trophy className="size-4" /> National trends
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">By athletic conference</h1>
        <p className="mt-3 text-muted-foreground">
          A conference as a group of colleges: how its members compare on admissions, cost, and size, how that changed, and who joined or left.
        </p>
      </header>
      {children}
    </div>
  );
}
