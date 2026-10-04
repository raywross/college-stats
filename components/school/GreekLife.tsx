import type { ReactNode } from "react";
import { CalendarDays, ChevronDown, Home, Users } from "lucide-react";
import { getData } from "@/lib/data";
import { num, pctSmart } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import { fratMedian, greekCard, greekParticipationBlankOrZero, greekReporters, sorMedian } from "@/lib/cds/greek-display";
import { latestDirectoryRead, listingsFor } from "@/lib/directories";
import { citePage, greekCouncils, hasGreekPageFacts, isFresh } from "@/lib/campus-pages";
import { greekView, type CouncilView } from "@/lib/campus-view";
import { loadOrganizations } from "@/lib/organizations";
import type { SchoolDetail } from "@/lib/detail";
import type { School } from "@/lib/types";
import { BenchmarkBar } from "@/components/charts/BenchmarkBar";
import { BLOCK_SCROLL } from "@/components/profile/Panel";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { FactChip, ListingCard } from "./CampusListing";

/**
 * Greek life (specs/greek-life.md): what applicants ask first, up top — how many chapters and councils (the college's
 * own count when its pages give one), how many students join (CDS F1, against the median college), and the
 * recruitment and housing facts as chips — then one row per council that opens to its chapters, each with the
 * organization's logo or letters, a link to its site, and the chapter's own page when the national list gives one.
 *
 * Sources stay in the ⓘ (quiet sources): the college's pages for its counts, CDS for participation, each
 * organization's list for each chapter. A college count and a list count are never added together.
 *
 * Status rule (phase 4 "none found" vs. "none reported"): a college with neither a CDS answer, a college-page fact,
 * nor any directory listing gets "No fraternity or sorority chapters found in national directories (month, year)" —
 * never "none" — and only once a directory sweep has run (`latestDirectoryRead`).
 */
export async function GreekLife({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const { citeField, getAllSchools } = await getData();
  const card = greekCard(school);
  const listings = listingsFor(detail?.tables.directories?.rows, "greek");
  const now = new Date().toISOString().slice(0, 10);
  const rows = detail?.tables.campus_pages?.rows ?? null;
  const pageFacts = hasGreekPageFacts(rows, now);

  if (!card && !listings.length && !pageFacts) {
    if (!greekParticipationBlankOrZero(school)) return null;
    const checked = latestDirectoryRead(getAllSchools());
    if (!checked) return null;
    return (
      <div id="greek" className={cn("rounded-3xl border bg-card p-4 sm:p-6", BLOCK_SCROLL)}>
        <h3 className="mb-2 flex items-center gap-1.5 font-display text-lg font-bold">
          Greek life <InfoTip term="greek-life" />
        </h3>
        <p className="text-sm text-muted-foreground">No fraternity or sorority chapters found in national directories ({checked}).</p>
      </div>
    );
  }

  const color = DOMAINS.size.color;
  const view = greekView(greekCouncils(rows, now), listings, loadOrganizations().organizations);
  const g = rows?.greek;
  const fresh = <T extends { checked: string }>(r: T | undefined) => (r && isFresh(r.checked, now) ? r : undefined);
  const none = fresh(g?.none_stated);
  const deferred = fresh(g?.deferred);
  const formal = fresh(g?.formal_term);
  const pageHousing = fresh(g?.housing);
  const membersTotal = fresh(g?.members_total);
  const reporters = card?.frat || card?.sor ? greekReporters(getAllSchools()) : [];
  const hasBars = card?.frat?.undergrad != null || card?.sor?.undergrad != null;
  const listedOnly = view.councils.length > 0 && view.councils.every((c) => c.chapters === null);
  const listedCount = view.councils.reduce((s, c) => s + c.listings.length, 0);
  const term = view.councils.find((c) => c.term)?.term ?? null;
  const nCouncils = view.councils.length;
  // With one council its row already says it all; the headline would repeat the same number.
  const showHeadline = nCouncils > 1;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const headline =
    view.total !== null
      ? { n: view.total, unit: plural(view.total, "chapter", "chapters"), note: `In ${nCouncils} ${plural(nCouncils, "council", "councils")}, as the college counts them${term ? ` (${term})` : ""}.` }
      : listedOnly
        ? { n: listedCount, unit: plural(listedCount, "chapter", "chapters"), note: "On the national organizations' own chapter lists." }
        : { n: nCouncils, unit: "councils", note: "Chapters by council below: the college's own count where its pages give one." };

  const chips = [
    formal && (
      <FactChip key="formal" icon={CalendarDays} tip={<SourceTip cited={citePage(formal, school.name, "Formal recruitment")} />}>
        Recruitment: {formal.value}
      </FactChip>
    ),
    deferred && (
      <FactChip key="deferred" icon={CalendarDays} tip={<InfoTip term="deferred-recruitment" cited={citePage(deferred, school.name, "Deferred recruitment")} />}>
        {deferred.value === "yes" ? "Deferred recruitment" : "First-years can join in their first term"}
      </FactChip>
    ),
    pageHousing ? (
      <FactChip key="housing" icon={Home} tip={<SourceTip cited={citePage(pageHousing, school.name, "Chapter houses")} />}>
        {pageHousing.value === "yes" ? "Chapter houses" : "No chapter houses"}
      </FactChip>
    ) : (
      card?.housing && (
        <FactChip key="housing" icon={Home} tip={<InfoTip term="greek-life" cited={citeField("reported.greek.housing", school)} />}>
          Fraternity and sorority housing
        </FactChip>
      )
    ),
  ].filter(Boolean);

  return (
    <div id="greek" className={cn("rounded-3xl border bg-card p-4 sm:p-6", BLOCK_SCROLL)}>
      <h3 className="mb-5 flex items-center gap-1.5 font-display text-lg font-bold">
        Greek life <InfoTip term="greek-life" />
      </h3>

      {none && (
        <p className="mb-5 text-base font-semibold">
          No fraternities or sororities, the college says.{" "}
          <SourceTip cited={citePage(none, school.name, "No fraternities or sororities")} />
        </p>
      )}

      {(showHeadline || hasBars) && (
        <div className={cn("grid gap-6", showHeadline && hasBars && "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8")}>
          {showHeadline && (
            <div>
              {/* One number, never a college count added to a list count: all chapters when the college counts every
                  council, the listed chapters when only the lists speak, else the number of councils. */}
              <div className="flex items-baseline gap-2">
                <span className="font-display text-5xl font-extrabold tracking-tight">{headline.n}</span>
                <span className="text-sm text-muted-foreground">{headline.unit}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{headline.note}</p>
              {membersTotal && (
                <p className="mt-2 flex items-center gap-1 text-sm">
                  <Users className="size-4" style={{ color }} aria-hidden />
                  <b>{num(membersTotal.value)}</b> members{membersTotal.term ? `, ${membersTotal.term}` : ""}
                  <SourceTip cited={citePage(membersTotal, school.name, "Fraternity and sorority members")} />
                </p>
              )}
            </div>
          )}
          {hasBars && (
            <div className={cn("grid gap-5", !showHeadline && "sm:grid-cols-2")}>
              {card?.frat?.undergrad != null && (
                <BenchmarkBar
                  label="Undergrad men in a fraternity"
                  term="greek-life"
                  cited={citeField("reported.greek.frat_pct_undergrad", school)}
                  value={card.frat.undergrad}
                  median={fratMedian(reporters) ?? undefined}
                  scale={[0, 1]}
                  format={pctSmart}
                  color={color}
                />
              )}
              {card?.sor?.undergrad != null && (
                <BenchmarkBar
                  label="Undergrad women in a sorority"
                  term="greek-life"
                  cited={citeField("reported.greek.sor_pct_undergrad", school)}
                  value={card.sor.undergrad}
                  median={sorMedian(reporters) ?? undefined}
                  scale={[0, 1]}
                  format={pctSmart}
                  color={color}
                />
              )}
              {(card?.frat?.firstYear != null || card?.sor?.firstYear != null) && (
                <p className="-mt-2 text-xs text-muted-foreground">
                  Among first-years:{" "}
                  {[card?.frat?.firstYear != null && `${pctSmart(card.frat.firstYear)} of men`, card?.sor?.firstYear != null && `${pctSmart(card.sor.firstYear)} of women`]
                    .filter(Boolean)
                    .join(", ")}
                  .
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {chips.length > 0 && <ul className={cn("flex flex-wrap gap-2", (showHeadline || hasBars) && "mt-5")}>{chips}</ul>}

      {view.councils.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            Councils and chapters <InfoTip term="greek-council" />
          </h4>
          <ul className="divide-y rounded-2xl border">
            {view.councils.map((c) => (
              <li key={c.key}>
                <CouncilRow council={c} school={school} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The left column of a council row: the count as a display number, and what it counts. */
function CountCell({ council: c }: { council: CouncilView }) {
  const n = c.chapters ?? c.listings.length;
  return (
    <span className="w-12 shrink-0 text-center">
      <span className="block font-display text-2xl leading-none font-extrabold">{n}</span>
      <span className="mt-1 block text-[10px] leading-tight text-muted-foreground">{c.chapters !== null ? (n === 1 ? "chapter" : "chapters") : "listed"}</span>
    </span>
  );
}

function CouncilName({ council: c, tip, note }: { council: CouncilView; tip?: ReactNode; note?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold">
        {c.name ?? c.label}
        {tip && <> {tip}</>}
      </span>
      {c.name && <span className="block text-xs text-muted-foreground">{c.label}</span>}
      {c.members && <span className="block text-xs text-muted-foreground">{c.members} members</span>}
      {note && <span className="mt-0.5 block text-[11px] text-muted-foreground italic">{note}</span>}
    </span>
  );
}

/**
 * One council: a native disclosure when national lists name any of its chapters (works without JavaScript), a plain
 * row otherwise. The college's count is cited inside the open row, so tapping its ⓘ never toggles the row.
 */
function CouncilRow({ council: c, school }: { council: CouncilView; school: School }) {
  const collegeTip = c.ref ? <SourceTip cited={citePage(c.ref, school.name, `${c.name}${c.term ? `, ${c.term}` : ""}`)} /> : null;
  if (!c.listings.length) {
    return (
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <CountCell council={c} />
        <CouncilName council={c} tip={collegeTip} note="Its chapters aren't on the national lists we read yet." />
      </div>
    );
  }
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-surface-2/60 sm:px-4 [&::-webkit-details-marker]:hidden">
        <CountCell council={c} />
        <CouncilName council={c} />
        <span className="hidden shrink-0 text-xs font-medium text-primary sm:inline">
          <span className="group-open:hidden">Show chapters</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-3 pb-4 sm:px-4">
        <p className="mb-1 text-xs text-muted-foreground">
          {c.chapters !== null ? (
            <>
              {c.listings.length < c.chapters
                ? `${c.listings.length} of the college's ${c.chapters} chapters are on the national lists we read.`
                : "The chapters on the national lists we read."}{" "}
              {collegeTip}
            </>
          ) : (
            <>
              From each organization&apos;s own chapter list. <InfoTip term="national-directory" />
            </>
          )}
        </p>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {c.listings.map((v) => (
            <ListingCard key={`${v.listing.org}|${v.listing.name ?? ""}`} view={v} icon={Users} />
          ))}
        </div>
      </div>
    </details>
  );
}
