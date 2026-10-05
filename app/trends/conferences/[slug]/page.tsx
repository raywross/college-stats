import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Trophy } from "lucide-react";
import { getData, getHistoryFiles, getTrendFile } from "@/lib/data";
import { crestBrand } from "@/lib/brand";
import { CONFERENCES, CONFERENCE_LEVELS, conferenceBySlug, conferenceName } from "@/lib/conferences";
import { formatBy } from "@/lib/format";
import { historyYearLabel, type YearKind } from "@/lib/history";
import type { ConferenceGlanceKey } from "@/lib/trends";
import type { School } from "@/lib/types";
import { DotRange, type DotRangeRow } from "@/components/charts/DotRange";
import { Crest } from "@/components/school/Crest";
import { ConferenceOverTime } from "@/components/trends/conferences/ConferenceOverTime";
import { MembersCompared } from "@/components/trends/conferences/MembersCompared";
import { measureInfo } from "@/components/trends/conferences/measures";
import { groupMoves, leagueName } from "@/components/trends/conferences/moves";
import { HistorySourceNote } from "@/components/sources/HistorySourceNote";
import { SourceNote } from "@/components/sources/SourceNote";
import { Term } from "@/components/ui/info-tip";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const code = conferenceBySlug((await params).slug);
  const name = code === null ? "Conference" : CONFERENCES[code].name;
  return { title: `${name}: trends`, description: `How the ${name}'s member colleges compare and changed: admissions, cost, size, and who joined or left.` };
}

// Rendered on first visit and kept for a day; publishes revalidate sooner. An empty list makes Next render each
// conference on first visit and keep it (ISR) rather than rendering every one at build or on every request
// (node_modules/next/dist/docs: generateStaticParams, "All paths at runtime").
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

const levelLabel = (level: string) => CONFERENCE_LEVELS.find((l) => l.level === level)?.label ?? level;
const yearOf = (y: number | null, kind: YearKind | null) => (y === null || kind === null ? "" : historyYearLabel(y, kind).replace(/^Fall/, "fall"));

/** /trends/conferences/{slug} (specs/trends/conferences.md): one conference's members, medians, change, and moves. */
export default async function ConferencePage({ params }: Props) {
  const { slug } = await params;
  const code = conferenceBySlug(slug);
  if (code === null) notFound();
  const [file, files, data] = await Promise.all([getTrendFile("conferences"), getHistoryFiles(), getData()]);
  const row = file?.conferences.find((c) => c.code === code);
  if (file && !row) notFound();
  const def = CONFERENCES[code];

  const header = (
    <>
      <Link href="/trends/conferences" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> All conferences
      </Link>
      <header className="mt-4 mb-8 max-w-3xl sm:mb-10">
        <p className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase max-sm:hidden">
          <Trophy className="size-4" /> {def.level ? levelLabel(def.level) : "Athletic conference"}
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{def.name}</h1>
      </header>
    </>
  );
  if (!file || !files || !row) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
        {header}
        <div className="rounded-3xl border border-dashed p-6 text-muted-foreground sm:p-8">
          <p className="font-semibold text-foreground">Conference trends aren&apos;t available yet.</p>
          <p className="mt-1 text-sm">They&apos;re computed from the site&apos;s year-by-year history, and appear once that data is published.</p>
        </div>
      </div>
    );
  }

  const { citeField } = data;
  const ids = [...new Set([...row.members, ...(row.footballMembers ?? []), ...row.moves.map((m) => m.unit_id)])];
  const schools = new Map<string, School>(data.getSchoolsByIds(ids).map((s) => [s.unit_id, s]));
  const nameOf = (id: string) => schools.get(id)?.name ?? id;
  const memberIds = (row.footballOnly ? row.footballMembers ?? [] : row.members).slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const asOf = citeField("campus.athletics").year;
  const pellYear = citeField("demographics.pell_grant_percent").year;
  const shortName = def.name.replace(/^The /, "");

  const glanceRows: DotRangeRow[] = file.glance.flatMap((g) => {
    const v = row.glance?.[g.key];
    if (!v) return [];
    const info = measureInfo(g.key);
    const year = g.key === "pell" ? (pellYear ?? "") : yearOf(g.year, g.kind);
    return [
      {
        key: g.key,
        label: <Term term={info.term}>{info.label}</Term>,
        sub: `${year}${year ? " · " : ""}${v.n} of ${row.members.length} reporting`,
        value: v.median,
        min: v.min,
        max: v.max,
        reference: g.national,
        format: info.format,
        color: info.color,
        share: info.share,
      },
    ];
  });

  const compared = file.glance.map((g, i) => ({
    key: g.key as ConferenceGlanceKey,
    sub: g.key === "pell" ? (pellYear ?? "") : yearOf(g.year, g.kind),
    median: row.glance?.[g.key]?.median ?? null,
    values: row.members.map((id) => ({ id, name: nameOf(id), value: row.values?.[id]?.[i] ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  const apps = file.measures.find((m) => m.key === "applicants")!;
  const ug = file.measures.find((m) => m.key === "undergrads")!;
  const fall = (y: number) => historyYearLabel(y, "fall").toLowerCase();
  const t = row.totals;
  const timeline = groupMoves(row.moves);
  const from = file.membership.from;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      {header}
      <div className="-mt-4 mb-10 flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
        <p>
          {row.footballOnly ? (
            <>
              A football-only conference: {memberIds.length} of the site&apos;s colleges play football in it, each with another main conference, so it has no
              medians here.
            </>
          ) : (
            <>
              {row.members.length} members on the site, as of {asOf ?? "the newest survey"}
              {Object.keys(row.football).length > 0 && <>; {Object.keys(row.football).length} play football in another conference</>}.
            </>
          )}
        </p>
        {!row.footballOnly && (
          <Link href={`/explore?conference=${code}`} className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
            See them in Explore <ArrowRight className="size-4" />
          </Link>
        )}
      </div>

      <div className="space-y-14 sm:space-y-20">
        <section aria-labelledby="members">
          <h2 id="members" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Members
          </h2>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {memberIds.map((id) => {
              const s = schools.get(id);
              const joined = row.joined[id];
              const fb = row.football[id];
              return (
                <li key={id}>
                  <Link href={`/schools/${id}`} className="flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-2.5 transition-colors hover:border-primary">
                    <Crest id={id} name={nameOf(id)} size="sm" brand={s ? crestBrand(s) : undefined} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{nameOf(id)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[
                          s ? `${s.location.city}, ${s.location.state}` : null,
                          joined ? `joined ${historyYearLabel(joined, "academic")}` : null,
                          fb ? `football: ${conferenceName(fb)?.replace(/^The /, "")}` : null,
                          row.footballOnly && s?.campus?.athletics?.conference ? `main: ${s.campus.athletics.conference.name}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {row.tooFew && !row.footballOnly && (
          <p className="max-w-3xl rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
            <b className="text-foreground">Too few members to summarize.</b> A conference needs {file.floor} members on the site before this page shows
            medians; the {shortName} has {row.members.length}. Its members and moves are above and below.
          </p>
        )}

        {glanceRows.length > 0 && (
          <section aria-labelledby="glance">
            <h2 id="glance" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              At a glance
            </h2>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              The median member against the median of every four-year college on the site, with the range from the lowest member to the highest. Each row has
              its own scale, starting at zero.
            </p>
            <div className="mt-5 rounded-3xl border bg-card p-4 sm:p-5">
              <DotRange rows={glanceRows} valueLabel={`${shortName} median`} referenceLabel="All four-year colleges (median)" />
            </div>
          </section>
        )}

        {row.lines && (
          <section aria-labelledby="over-time">
            <h2 id="over-time" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Over time
            </h2>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              The median member each year. By default the line follows <Term term="conference-membership">today&apos;s members</Term> in every year, so it
              describes the same colleges throughout; switch to <i>members at the time</i> to see the conference as it was.
            </p>
            <div className="mt-5">
              <ConferenceOverTime name={shortName} measures={file.measures} lines={row.lines} membershipFrom={from} coverage={file.coverage} />
            </div>
            {t && (t.applicants || t.undergrads) && (
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
                <b className="text-foreground">In total</b> (members reporting both years):{" "}
                {t.applicants && (
                  <>
                    {t.applicants.n} members received {formatBy("compact", t.applicants.now)} applications in {fall(apps.to)}, against{" "}
                    {formatBy("compact", t.applicants.then)} in {fall(apps.from)}
                  </>
                )}
                {t.applicants && t.undergrads && "; "}
                {t.undergrads && (
                  <>
                    {t.undergrads.n === t.applicants?.n ? "they" : `${t.undergrads.n} members`} enrolled {formatBy("compact", t.undergrads.now)} undergraduates in{" "}
                    {fall(ug.to)}, against {formatBy("compact", t.undergrads.then)} in {fall(ug.from)}
                  </>
                )}
                .
              </p>
            )}
          </section>
        )}

        {glanceRows.length > 0 && (
          <section aria-labelledby="compared">
            <h2 id="compared" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Members compared
            </h2>
            <p className="mt-2 max-w-3xl text-muted-foreground">Every member on each measure, highest first, so the spread behind each median is visible.</p>
            <div className="mt-5">
              <MembersCompared measures={compared} members={row.members.length} />
            </div>
          </section>
        )}

        <section aria-labelledby="realignment">
          <h2 id="realignment" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Who joined and left
          </h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Moves since {historyYearLabel(from, "academic")}, among the site&apos;s colleges, by the school year the college first reported its new conference.
          </p>
          {timeline.length ? (
            <ol className="mt-5 max-w-3xl space-y-2 border-l-2 pl-4">
              {timeline.map((g) => (
                <li key={`${g.year}-${g.joined}-${g.other}-${g.football}`} className="text-sm">
                  <b className="tabular-nums">{historyYearLabel(g.year, "academic")}:</b>{" "}
                  {g.ids.map((id, i) => (
                    <span key={id}>
                      <Link href={`/schools/${id}`} className="font-semibold hover:text-primary hover:underline">
                        {nameOf(id)}
                      </Link>
                      {i < g.ids.length - 2 ? ", " : i === g.ids.length - 2 ? " and " : ""}
                    </span>
                  ))}{" "}
                  <span className="text-muted-foreground">
                    {g.football ? "(football) " : ""}
                    {g.joined ? `joined from ${leagueName(g.other)}` : `left for ${leagueName(g.other)}`}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">No moves in or out since {historyYearLabel(from, "academic")}.</p>
          )}
        </section>

        <section aria-labelledby="method" className="max-w-3xl">
          <h2 id="method" className="font-display text-2xl font-extrabold tracking-tight">
            How this was measured
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground marker:text-border">
            <li>
              <b className="text-foreground">Members.</b> Colleges that report the {shortName} as their main{" "}
              <Term term="athletic-conference">athletic conference</Term> today. A member playing football elsewhere is listed with its football conference
              but counted here.
            </li>
            <li>
              <b className="text-foreground">Medians.</b> Every figure is the median member (counts and costs: the median member&apos;s own change), except the
              totals, which are labeled. A conference needs {file.floor} members on the site, and a year needs {Math.round(file.coverage * 100)}% of members
              reporting; costs are <Term term="inflation-adjusted">after inflation</Term>.
            </li>
            <li>
              <b className="text-foreground">Members at the time</b> reads each college&apos;s reported conference year by year, from{" "}
              {historyYearLabel(from, "academic")}; colleges no longer on the site aren&apos;t included.
            </li>
            <li>
              <b className="text-foreground">The universe.</b> The site&apos;s four-year colleges, which may not be every member. The page shows how members compare
              and changed, not why.
            </li>
          </ul>
          <HistorySourceNote
            className="mt-4"
            keys={["conference", "applicants", "acceptance_rate", "undergrads", "avg_paid_all", "out_of_state_share", "grad_rate"]}
            files={files}
            range={[Math.min(...file.glance.flatMap((g) => (g.year === null ? [] : [g.year])), ...file.measures.map((m) => m.from)), file.membership.to]}
          />
          {glanceRows.some((r) => r.key === "pell") && <SourceNote fields={["demographics.pell_grant_percent"]} prefix="Pell Grant recipients" className="mt-1" />}
        </section>

        <nav aria-label="Related" className="flex flex-wrap gap-2">
          {[
            { href: "/trends/conferences", label: "All conferences" },
            { href: "/trends/shrinking-colleges", label: "Shrinking colleges" },
            { href: "/trends", label: "All national trends" },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="group inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary">
              {l.label} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
