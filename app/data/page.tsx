import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BookMarked, Calculator, CalendarClock, ExternalLink, Eye, Hourglass, RefreshCw, Scale, TriangleAlert } from "lucide-react";
import { getData } from "@/lib/data";
import type { SourceKey, Topic } from "@/lib/types";
import { num } from "@/lib/format";
import { FIELDS, type FieldDef, type FieldPath, type VintageKey } from "@/lib/fields";
import { VINTAGE_KEYS, yearLabel } from "@/lib/lineage";
import {
  STALE_AFTER_DAYS,
  dateLabel,
  daysSince,
  expectedLabel,
  isOverdue,
  isStale,
  nextReleaseFor,
  parseMonth,
  periodStart,
  upcoming,
  type Release,
} from "@/lib/releases";
import { DataAgeTimeline, type DataAgeRow } from "@/components/charts/DataAgeTimeline";
import { Crest } from "@/components/school/Crest";
import { SourceChip, Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Data" };

// "Today" on the timeline, overdue releases, and the review warning move with the calendar, so re-render daily.
export const revalidate = 86400;

const TOPIC_LABELS: Record<Topic, string> = {
  institution: "Name, location & type",
  admissions: "Admissions & test scores",
  enrollment: "Enrollment",
  demographics: "Student background",
  cost: "Net price & cost",
  prices: "Sticker prices",
  outcomes: "Earnings, graduation & debt",
  aid: "Financial aid",
};

const STORED = (Object.entries(FIELDS) as [FieldPath, FieldDef][]).filter(([, def]) => !def.computed);

/** Stored fields whose default source is this release (lib/fields.ts). */
const fieldsOf = (v: VintageKey) => STORED.filter(([, def]) => def.vintage === v && def.source !== "cds");

/** What a release is used for: its fields when there are a few, else their topics. */
function usedFor(v: VintageKey): string {
  const fields = fieldsOf(v);
  if (fields.length <= 3) return fields.map(([, d]) => d.label).join(" · ");
  const topics = new Set(fields.map(([, d]) => d.topic).filter((t) => t !== "institution"));
  return [...topics].map((t) => TOPIC_LABELS[t]).join(" · ");
}

/** Mid-month, so a marker sits inside the month it stands for. */
const midMonth = (yyyyMm: string) => {
  const d = parseMonth(yyyyMm);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15)).toISOString();
};

function StatusBadge({ r, now }: { r: Release; now: Date }) {
  if (isOverdue(r, now))
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-foreground">
        <TriangleAlert className="size-3 text-warning" aria-hidden /> Later than expected
      </span>
    );
  const styles: Record<Release["status"], string> = {
    estimated: "bg-muted text-muted-foreground",
    confirmed: "bg-secondary text-secondary-foreground",
    published: "bg-pop/80 text-pop-foreground",
  };
  if (r.status !== "published" && !r.expected) return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", styles.estimated)}>No set date</span>;
  const text = { estimated: "Estimated", confirmed: "Confirmed", published: "Out now" }[r.status];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", styles[r.status])}>{text}</span>;
}

function Section({ id, eyebrow, title, icon, children }: { id: string; eyebrow: string; title: ReactNode; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-16 scroll-mt-24 space-y-4 first:mt-0">
      <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-primary uppercase">
        {icon} {eyebrow}
      </p>
      <h2 id={`${id}-h`} className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

const ExtLink = ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1 font-semibold text-primary hover:underline", className)}>
    {children} <ExternalLink className="size-3.5" aria-hidden />
  </a>
);

export default async function DataPage() {
  const { cdsSchools, citeField, getAllSchools, getMeta, getReleaseCalendar } = await getData();
  const meta = getMeta();
  const all = getAllSchools();
  const cds = cdsSchools();
  const calendar = getReleaseCalendar();
  const now = new Date();
  const stale = isStale(calendar, now);

  /* ---- What's on the site now: one row per federal release (meta.json vintages) ---- */
  const rows: DataAgeRow[] = VINTAGE_KEYS.filter((v) => fieldsOf(v).length).map((v) => {
    const cited = citeField(fieldsOf(v)[0][0]);
    const next = nextReleaseFor(v, calendar);
    const start = periodStart(cited.year);
    return {
      id: v,
      label: cited.label,
      year: yearLabel(cited),
      start: start?.toISOString() ?? null,
      usedFor: usedFor(v),
      next: next?.expected ? midMonth(next.expected) : null,
      nextLabel: !next ? (
        "Not scheduled"
      ) : !next.expected ? (
        <a href={next.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
          Irregular
        </a>
      ) : (
        <>
          <b className="font-semibold text-foreground">~{expectedLabel(next)}</b> · {isOverdue(next, now) ? "later than expected" : next.status}
        </>
      ),
      noBarNote: start ? undefined : "Cohorts vary by measure",
    };
  });

  /* ---- Why the data lags: follow the next admissions class through the pipeline ---- */
  const admCited = citeField("admissions.applicants");
  const admStart = periodStart(admCited.year);
  const nextAdm = nextReleaseFor("ipeds-adm", calendar);
  const lagSteps = admStart
    ? (() => {
        const y = admStart.getUTCFullYear() + 1;
        return [
          { when: `Fall ${y}`, what: "The class enrolls" },
          // IPEDS winter collection: admissions are reported December through February.
          { when: `Dec ${y} – Feb ${y + 1}`, what: "Colleges report it to IPEDS" },
          { when: nextAdm?.expected ? `~${expectedLabel(nextAdm)}` : `~Dec ${y + 1}`, what: "NCES publishes it" },
          { when: "Our next update", what: "It appears here" },
        ];
      })()
    : [];

  /* ---- How we compare: colleges with Common Data Set values ---- */
  const admYear = admStart?.getUTCFullYear() ?? null;
  const newerCds = cds.filter((s) => {
    const y = periodStart(s.cds!.edition)?.getUTCFullYear();
    return admYear !== null && y !== undefined && y > admYear;
  });
  const example = cds[0];
  const exampleField = example
    ? ((Object.entries(example.lineage ?? {}).find(([, r]) => r?.source === "cds")?.[0] as FieldPath | undefined) ?? null)
    : null;
  const exampleCited = example && exampleField ? citeField(exampleField, example) : null;

  /* ---- Upcoming releases ---- */
  const next = upcoming(calendar);
  const justOut = calendar.releases.filter((r) => r.status === "published");

  /* ---- Sources (from the former /sources page) ---- */
  const coverage: Record<SourceKey, number> = {
    scorecard: all.length,
    "ipeds-adm": all.filter((s) => s.admissions.year !== null && !s.lineage?.["admissions.applicants"]).length,
    "ipeds-sfa": all.filter((s) => s.aid?.grant_pct != null).length,
    "ipeds-ic": all.filter((s) => s.cost?.sticker).length,
    cds: cds.length,
  };
  const sourceUses = (key: SourceKey) => {
    const topics = new Set<Topic>();
    for (const [, def] of STORED) if (def.source === key) topics.add(def.topic);
    return [...topics].map((t) => TOPIC_LABELS[t]);
  };
  const order: SourceKey[] = ["scorecard", "ipeds-adm", "ipeds-sfa", "ipeds-ic", "cds"];

  const toc = [
    ["why", "Why it lags"],
    ["now", "On the site now"],
    ["upcoming", "Upcoming releases"],
    ["compare", "How we compare"],
    ["watching", "Watching"],
    ["sources", "Sources"],
    ["method", "How we calculate"],
  ] as const;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-10">
        <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Data</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          Where the <span className="highlight">numbers</span> come from, and how new they are
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every figure on this site comes from public data published by the U.S. Department of Education or by the colleges
          themselves. This page shows which year each dataset describes, why that&apos;s a year or more ago, when newer data is
          due, and how we calculate what we show. Data last retrieved <b className="text-foreground">{dateLabel(meta.retrieved)}</b>.
        </p>
        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary">
              {label}
            </a>
          ))}
        </nav>
      </header>

      {/* 1. Why the data lags */}
      <Section id="why" eyebrow="Timing" title="Why the data is a year or more behind" icon={<Hourglass className="size-4" aria-hidden />}>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Most figures come from federal surveys that every college must complete. Colleges report each year&apos;s numbers
          after the fact, and the National Center for Education Statistics (NCES) checks them before publishing, usually 9 to
          12 months after reporting closes. So the newest federal data always describes a class that started a year or two ago.
          Here&apos;s the path the next admissions class takes:
        </p>
        {lagSteps.length > 0 && (
          <ol className="grid gap-2 sm:grid-cols-4">
            {lagSteps.map((s, i) => (
              <li key={s.what} className="relative flex items-start gap-3 rounded-2xl border bg-card p-4 sm:flex-col sm:gap-1">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                  {i + 1}
                </span>
                <div>
                  <p className="font-display text-base font-bold">{s.when}</p>
                  <p className="text-sm text-muted-foreground">{s.what}</p>
                </div>
                {i < lagSteps.length - 1 && (
                  <ArrowRight className="absolute top-1/2 -right-3.5 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-background p-0.5 text-muted-foreground sm:block" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Colleges publish some numbers sooner, in their own class profiles and <Term term="cds">Common Data Sets</Term>. Those
          are newer but not standardized or checked by NCES, so we use them only where noted (see{" "}
          <a href="#compare" className="font-semibold text-primary hover:underline">
            how we compare colleges
          </a>
          ).
        </p>
      </Section>

      {/* 2. What's on the site now */}
      <Section id="now" eyebrow="Vintages" title="What's on the site now" icon={<CalendarClock className="size-4" aria-hidden />}>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each federal dataset we use, the year it describes, and when a newer year is expected. Each bar runs from the start
          of that year to today.
        </p>
        <DataAgeTimeline rows={rows} today={now.toISOString()} />
        <p className="text-xs text-muted-foreground">
          Outcomes such as earnings and graduation rates follow students for years after they enroll, so each describes a
          different, earlier group of students; the College Scorecard documents the cohorts behind each measure.
        </p>
      </Section>

      {/* 3. Upcoming releases */}
      <Section id="upcoming" eyebrow="Calendar" title="Upcoming releases" icon={<RefreshCw className="size-4" aria-hidden />}>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Dates are <b className="text-foreground">estimated</b> from each publisher&apos;s past schedule until they&apos;re
          announced. Our data sync checks NCES for each release&apos;s files and marks it out as soon as they appear. Calendar
          last reviewed <b className="text-foreground">{dateLabel(calendar.reviewed)}</b>.
        </p>
        {stale && (
          <p role="status" className="flex items-start gap-2 rounded-2xl border border-warning/50 bg-warning/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              This calendar hasn&apos;t been reviewed in {daysSince(calendar.reviewed, now)} days (we review at least every{" "}
              {STALE_AFTER_DAYS}). Dates may have changed; check each publisher&apos;s link.
            </span>
          </p>
        )}
        {justOut.length > 0 && (
          <ul className="grid gap-3">
            {justOut.map((r) => (
              <li key={r.id} className="rounded-2xl border border-pop bg-card p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge r={r} now={now} />
                  <b>{r.label}</b>
                  {r.published && <span className="text-muted-foreground">found {dateLabel(r.published)}; on the site after our next update</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <ul className="grid gap-3 md:grid-cols-2">
          {next.map((r) => (
            <li key={r.id} className="flex flex-col rounded-3xl border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-bold">{expectedLabel(r)}</p>
                  <h3 className="text-sm font-semibold">{r.label}</h3>
                </div>
                <StatusBadge r={r} now={now} />
              </div>
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm">
                {r.brings.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {r.note && <p className="mt-2 text-xs font-medium">{r.note}</p>}
              <p className="mt-2 text-xs text-muted-foreground">{r.basis}</p>
              {r.url && (
                <ExtLink href={r.url} className="mt-auto self-start pt-3 text-xs">
                  {r.source === "ipeds" ? "NCES release schedule" : r.source === "scorecard" ? "Scorecard changelog" : "About the Common Data Set"}
                </ExtLink>
              )}
            </li>
          ))}
        </ul>
        {calendar.notUsedYet.length > 0 && (
          <div className="rounded-2xl border bg-surface-2 p-4 text-sm">
            <h3 className="font-semibold">Already released, not used here yet</h3>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {calendar.notUsedYet.map((f) => (
                <li key={f.file}>
                  <a href={f.url} className="font-mono text-xs font-semibold text-foreground hover:text-primary">
                    {f.file}
                  </a>{" "}
                  ({dateLabel(f.released)}): {f.what}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* 4. How we compare colleges */}
      <Section id="compare" eyebrow="Fair comparisons" title="How we compare colleges" icon={<Scale className="size-4" aria-hidden />}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border bg-card p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold">Federal data is the baseline</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Rankings, national medians, Explore and Compare use the same federal releases for every college: the same year,
              the same definitions, checked by NCES. Colleges&apos; own reports can be newer, but each college publishes on its
              own schedule, so mixing them in would compare one college&apos;s newest class with another&apos;s older one.
            </p>
          </div>
          <div className="rounded-3xl border bg-card p-5 sm:p-6">
            <h3 className="font-display text-lg font-bold">Where colleges&apos; own figures appear</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              For {cds.length} {cds.length === 1 ? "college" : "colleges"}, we&apos;ve imported the college&apos;s own Common Data Set
              for admissions counts, test scores and aid detail federal data lacks.
              {newerCds.length > 0
                ? ` For ${newerCds.length} of them it describes a newer class than the federal data. `
                : " They describe the same class as the federal data. "}
              Every such value carries a tag with its source and year
              {exampleCited && (
                <>
                  , like <SourceChip cited={exampleCited} className="align-middle" />
                </>
              )}
              , and its ⓘ explains where it came from.
            </p>
            {example && (
              <Link href={`/schools/${example.unit_id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                See an example: {example.name} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </Section>

      {/* 5. Watching */}
      <Section id="watching" eyebrow="Watching" title="Sources we're watching" icon={<Eye className="size-4" aria-hidden />}>
        {calendar.watching.map((w) => (
          <article key={w.id} className="rounded-3xl border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="font-display text-lg font-bold">{w.name}</h3>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">{w.status}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed">{w.summary}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              <b className="text-foreground">Latest (as of {dateLabel(calendar.reviewed)}):</b> {w.latest}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              <b className="text-foreground">Why it matters:</b> {w.why}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {w.links.map((l) => (
                <ExtLink key={l.url} href={l.url}>
                  {l.label}
                </ExtLink>
              ))}
            </div>
          </article>
        ))}
      </Section>

      {/* 6. Sources */}
      <Section id="sources" eyebrow="Sources" title="The datasets" icon={<BookMarked className="size-4" aria-hidden />}>
        <div className="grid gap-4 md:grid-cols-2">
          {order.map((key) => {
            const s = meta.sources[key];
            const uses = sourceUses(key);
            return (
              <article key={key} className="flex flex-col rounded-3xl border bg-card p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg font-bold">{s.label}</h3>
                    <p className="text-xs text-muted-foreground">{s.publisher}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
                    {num(coverage[key])} {coverage[key] === 1 ? "college" : "colleges"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{s.description}</p>
                <dl className="mt-4 space-y-1 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">Edition</dt>
                    <dd className="font-medium">{s.edition}</dd>
                  </div>
                  {uses.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground">Used for</dt>
                      <dd className="font-medium">{uses.join(" · ")}</dd>
                    </div>
                  )}
                </dl>
                <ExtLink href={s.url} className="mt-auto self-start pt-4 text-sm">
                  {key === "cds" ? "About the Common Data Set" : "Get the data"}
                </ExtLink>
              </article>
            );
          })}
        </div>

        <h3 id="cds-list" className="scroll-mt-24 pt-6 font-display text-xl font-bold">
          Colleges with Common Data Set detail
        </h3>
        <p className="max-w-3xl text-sm text-muted-foreground">
          When a college publishes its Common Data Set as a spreadsheet, we import it for newer admissions figures and richer
          aid detail (share of students with need, <Term term="need-met">percent of need met</Term>,{" "}
          <Term term="merit-aid">merit aid</Term>). Federal data fills in everything else.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {cds.map((s) => (
            <li key={s.unit_id} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
              <Crest id={s.unit_id} name={s.name} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={`/schools/${s.unit_id}`} className="block truncate text-sm font-semibold hover:text-primary">
                  {s.name}
                </Link>
                <a href={s.cds!.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  Common Data Set {s.cds!.edition} <ExternalLink className="size-3" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="method" eyebrow="Methods" title="How we calculate" icon={<Calculator className="size-4" aria-hidden />}>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            {
              t: "Which colleges are included",
              d: "Every operating U.S. college that mainly awards bachelor's degrees, excluding online-only institutions and those reporting no undergraduates.",
            },
            {
              t: "Missing data",
              d: "If a college doesn't report something (for example, open-admission colleges have no acceptance rate), we show a dash and leave it out of rankings and medians. Missing is never treated as zero.",
            },
            {
              t: "National ranks & medians",
              d: "Each college is compared with every other college that reports the same measure. \"Higher than 80%\" means it's above 80% of them.",
            },
            {
              t: "Acceptance rate",
              d: "Admitted ÷ applicants from the same survey year. Not calculated for colleges with fewer than 10 applicants.",
            },
            {
              t: "SAT totals",
              d: "Colleges report Reading & Writing and Math ranges separately; we add them to estimate a total range. It's an approximation, since students aren't at the same percentile on both sections.",
            },
            {
              t: "Average cost (all students)",
              d: "Published net price figures only cover students who received aid. We estimate what the average first-year actually paid: the sticker price for each residency rate (tuition and fees plus books, on-campus room and board, and other expenses), weighted by how many students pay each rate, minus the share who got grants × their average grant. Students without grants count at full price. All inputs are from the same year (IPEDS). It assumes on-campus living, so it runs high at commuter-heavy schools.",
            },
            {
              t: "Aid generosity",
              d: "Total grant dollars ÷ number of first-years ÷ full price: the share of the full cost that grants cover for the average student, counting those who get none. Tiers: Very generous 55%+, Generous 40–55%, Moderate 25–40%, Limited under 25%.",
            },
            {
              t: "In-state vs. out-of-state",
              d: "Public universities show separate sticker prices for in-state and out-of-state students, and the share of first-years paying each rate. The all-student average weights them by that share.",
            },
            {
              t: "Net price by family income",
              d: "From the College Scorecard, for students receiving federal aid (who filed the FAFSA). Families who didn't file aren't included.",
            },
            {
              t: "Diversity index",
              d: "The chance two randomly chosen students come from different racial/ethnic groups (Simpson's index).",
            },
            {
              t: "Payback estimate",
              d: "Four years of average net price ÷ median earnings ten years after entry. A rough comparison, not a financial forecast.",
            },
          ].map((m) => (
            <div key={m.t} className="rounded-2xl border bg-card p-4">
              <h3 className="text-sm font-bold">{m.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{m.d}</p>
            </div>
          ))}
        </div>
        <p className="text-sm">
          Every term is defined in the{" "}
          <Link href="/glossary" className="font-semibold text-primary hover:underline">
            glossary
          </Link>
          .
        </p>

        <div className="grid gap-4 pt-4 md:grid-cols-2">
          <div className="rounded-3xl border bg-card p-5 sm:p-6">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold">
              <RefreshCw className="size-5 text-primary" aria-hidden /> Keeping it current
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              We rebuild the dataset from these sources regularly and switch to each new release automatically once it&apos;s
              published (see{" "}
              <a href="#upcoming" className="font-semibold text-primary hover:underline">
                upcoming releases
              </a>
              ).
            </p>
          </div>
          <div className="rounded-3xl border bg-card p-5 sm:p-6">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold">
              <Calculator className="size-5 text-primary" aria-hidden /> For your own numbers
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Averages can&apos;t tell you what your family will pay. Every college&apos;s profile links to its official{" "}
              <Term term="net-price-calculator">net price calculator</Term> for a personal estimate.
            </p>
          </div>
        </div>
      </Section>

      <p className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
        <BookMarked className="size-4 shrink-0" aria-hidden /> Suggested citation: Quad, compiled from the U.S. Department of
        Education College Scorecard and NCES IPEDS, retrieved {dateLabel(meta.retrieved)}.
      </p>
    </div>
  );
}
