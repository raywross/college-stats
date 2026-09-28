import type { Metadata } from "next";
import Link from "next/link";
import { BookMarked, Calculator, ExternalLink, RefreshCw } from "lucide-react";
import { cdsSchools, getAllSchools, getMeta } from "@/lib/data";
import type { SourceKey, Topic } from "@/lib/types";
import { num } from "@/lib/format";
import { Crest } from "@/components/school/Crest";
import { Term } from "@/components/ui/info-tip";

export const metadata: Metadata = { title: "Data sources" };

const TOPIC_LABELS: Record<Topic, string> = {
  admissions: "Admissions & test scores",
  enrollment: "Undergraduate enrollment",
  demographics: "Race/ethnicity, Pell & first-gen shares",
  cost: "Net price by family income",
  prices: "Sticker prices by residency",
  outcomes: "Earnings, graduation & debt",
  aid: "Financial aid",
};

export default function SourcesPage() {
  const meta = getMeta();
  const all = getAllSchools();
  const cds = cdsSchools();

  const coverage: Record<SourceKey, number> = {
    scorecard: all.length,
    "ipeds-adm": all.filter((s) => s.admissions.year !== null && !s.provenance?.admissions).length,
    "ipeds-sfa": all.filter((s) => s.aid?.grant_pct != null).length,
    "ipeds-ic": all.filter((s) => s.cost?.sticker).length,
    cds: cds.length,
  };
  const usedFor = (key: SourceKey) =>
    (Object.keys(meta.defaults) as Topic[]).filter((t) => meta.defaults[t] === key).map((t) => TOPIC_LABELS[t]);
  const order: SourceKey[] = ["scorecard", "ipeds-adm", "ipeds-sfa", "ipeds-ic", "cds"];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-10">
        <p className="mb-2 text-xs font-bold tracking-[0.18em] text-primary uppercase">Data sources</p>
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
          Where the <span className="highlight">numbers</span> come from
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every figure on this site comes from public data published by the U.S. Department of Education or by the
          colleges themselves. Each profile section cites its source; this page explains each dataset, what it covers, and
          how we calculate what we show. Data last retrieved <b className="text-foreground">{meta.retrieved}</b>.
        </p>
      </header>

      <section aria-labelledby="datasets" className="space-y-4">
        <h2 id="datasets" className="font-display text-2xl font-extrabold tracking-tight">
          The datasets
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {order.map((key) => {
            const s = meta.sources[key];
            const uses = usedFor(key);
            return (
              <article key={key} className="flex flex-col rounded-3xl border bg-card p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg font-bold">{s.label}</h3>
                    <p className="text-xs text-muted-foreground">{s.publisher}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-bold">{num(coverage[key])} {coverage[key] === 1 ? "college" : "colleges"}</span>
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
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex items-center gap-1 self-start pt-4 text-sm font-semibold text-primary hover:underline"
                >
                  {key === "cds" ? "About the Common Data Set" : "Get the data"} <ExternalLink className="size-3.5" />
                </a>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="cds-list" className="mt-14 space-y-4">
        <h2 id="cds-list" className="font-display text-2xl font-extrabold tracking-tight">
          Colleges with Common Data Set detail
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          When a college publishes its Common Data Set as a spreadsheet, we import it for newer admissions figures and
          richer aid detail (share of students with need, <Term term="need-met">percent of need met</Term>,{" "}
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
      </section>

      <section aria-labelledby="method" className="mt-14 space-y-4">
        <h2 id="method" className="font-display text-2xl font-extrabold tracking-tight">
          How we calculate
        </h2>
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
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <RefreshCw className="size-5 text-primary" /> Keeping it current
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We rebuild the dataset from these sources regularly. Federal surveys lag by a year or two (colleges report after
            each academic year ends), and we switch to each new IPEDS release automatically once NCES publishes it.
          </p>
        </div>
        <div className="rounded-3xl border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Calculator className="size-5 text-primary" /> For your own numbers
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Averages can&apos;t tell you what your family will pay. Every college&apos;s profile links to its official{" "}
            <Term term="net-price-calculator">net price calculator</Term> for a personal estimate.
          </p>
        </div>
      </section>

      <p className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
        <BookMarked className="size-4" /> Suggested citation: Quad, compiled from the U.S. Department of Education College
        Scorecard and NCES IPEDS, retrieved {meta.retrieved}.
      </p>
    </div>
  );
}
