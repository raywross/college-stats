import Link from "next/link";
import type { ReactNode } from "react";
import { Atom, BookHeart, Building2, Church, Cross, Flower, Flower2, HandCoins, HandHeart, HeartHandshake, MoonStar, Scale, Scroll, Sparkles, UsersRound, type LucideIcon } from "lucide-react";
import { getData } from "@/lib/data";
import { DOMAINS } from "@/lib/metrics";
import { IMPORTANCE_LABELS } from "@/lib/cds/admissions";
import { faithFamilyLabel, faithFilterOf, religionView } from "@/lib/religion";
import { listingsFor, type Tradition } from "@/lib/directories";
import { citePage, countLabel, hasFaithPageFacts, isFresh } from "@/lib/campus-pages";
import { faithView } from "@/lib/campus-view";
import { loadOrganizations } from "@/lib/organizations";
import type { SchoolDetail } from "@/lib/detail";
import type { School } from "@/lib/types";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { BLOCK_SCROLL } from "@/components/profile/Panel";
import { cn } from "@/lib/utils";
import { ListingCard, OutLink, SubHead } from "./CampusListing";

/** A neutral icon per tradition, for a group with no logo (decoration; the tradition's name is always beside it). */
export const TRADITION_ICONS: Record<Tradition, LucideIcon> = {
  jewish: Scroll,
  catholic: Cross,
  christian: Cross,
  orthodox: Cross,
  latter_day_saint: Church,
  muslim: MoonStar,
  hindu: Flower2,
  sikh: HandHeart,
  buddhist: Flower,
  bahai: Sparkles,
  nonreligious: Atom,
  interfaith: HeartHandshake,
  other: BookHeart,
};

/**
 * Campus life, "Religious life" (specs/religious-life.md): the college's own facts first, as a row of labeled values
 * like Housing's (IPEDS affiliation; CDS C7 religious commitment in admission, H14 scholarships, F2 campus ministries;
 * the faith office from its own pages), then "Faith communities": one card per national organization's group, under
 * its tradition, with the organization's logo (or the tradition's icon), a link to its site, and the campus group's
 * own page; then the college's own religious composition. Neutral facts only; sources in each ⓘ; hidden when empty.
 */
export async function ReligiousLife({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const view = religionView(school);
  const now = new Date().toISOString().slice(0, 10);
  const traditions = faithView(listingsFor(detail?.tables.directories?.rows, "faith"), loadOrganizations().organizations);
  const pageFacts = hasFaithPageFacts(detail?.tables.campus_pages?.rows ?? null, now);
  if (!view && !traditions.length && !pageFacts) return null;
  const { citeField } = await getData();
  const color = DOMAINS.size.color;
  const affiliation = view?.religion?.affiliation ?? null;
  const family = faithFilterOf(school);
  const aid = view?.aid ?? null;
  const aidKind = aid ? (aid.need && aid.non_need ? "need-based and non-need-based" : aid.need ? "need-based" : "non-need-based") : null;
  const f = detail?.tables.campus_pages?.rows.faith;
  const office = f?.office && isFresh(f.office.checked, now) ? f.office : null;
  const comp = f?.composition && isFresh(f.composition.checked, now) ? f.composition : null;
  const compItems = comp ? [...comp.items].sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (b.count ?? 0) - (a.count ?? 0)) : [];
  const maxShare = Math.max(...compItems.map((i) => i.share ?? 0), 0.0001);
  const groupCount = traditions.reduce((s, t) => s + t.items.length, 0);
  const hasFacts = !!(view?.religion || view?.commitment || aid || view?.ministries || office);

  const label = (Icon: LucideIcon, text: string, tip: ReactNode) => (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-4" style={{ color }} aria-hidden /> {text} {tip}
    </p>
  );

  return (
    <div id="religion" className={cn("rounded-3xl border bg-card p-4 sm:p-6", BLOCK_SCROLL)}>
      <h3 className="mb-5 font-display text-lg font-bold">Religious life</h3>
      {hasFacts && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {view?.religion && (
            <div>
              {label(Church, "Affiliation", <InfoTip term="religious-affiliation" cited={citeField("religion.affiliation", school)} />)}
              <p className="mt-1 text-sm font-semibold">{affiliation ? affiliation.label : "No religious affiliation"}</p>
              {affiliation && family && family !== "none" && (
                <p className="text-xs text-muted-foreground">
                  <Link href={`/explore?faith=${family}`} className="underline decoration-dotted underline-offset-4 hover:text-foreground">
                    Other {faithFamilyLabel(family)} colleges
                  </Link>
                </p>
              )}
            </div>
          )}
          {office && (
            <div>
              {label(Building2, "Faith office", <SourceTip cited={citePage(office, school.name, "Office for religious life")} />)}
              <p className="mt-1 text-sm font-semibold">
                <OutLink href={office.url}>{office.name}</OutLink>
              </p>
            </div>
          )}
          {view?.commitment && (
            <div>
              {label(Scale, "In admission", <InfoTip term="religious-commitment" cited={citeField("reported.admission_profile.factors.religious", school)} />)}
              <p className="mt-1 text-sm font-semibold">Religious affiliation or commitment: {IMPORTANCE_LABELS[view.commitment].toLowerCase()}</p>
            </div>
          )}
          {aid && (
            <div>
              {label(HandCoins, "Scholarships", <InfoTip term="religious-scholarships" cited={citeField("reported.religion.aid_by_affiliation", school)} />)}
              <p className="mt-1 text-sm font-semibold">Some of the college&apos;s own {aidKind} aid considers religious affiliation</p>
            </div>
          )}
          {view?.ministries && (
            <div>
              {label(UsersRound, "Campus ministries", <InfoTip term="campus-ministries" cited={citeField("reported.religion.campus_ministries", school)} />)}
              <p className="mt-1 text-sm font-semibold">Listed among campus activities</p>
            </div>
          )}
        </div>
      )}

      {traditions.length > 0 && (
        <div className={cn(hasFacts && "mt-6 border-t pt-5")}>
          <SubHead
            tip={<InfoTip term="national-directory" />}
            aside={
              traditions.length > 1 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Traditions">
                {traditions.map((t) => (
                  <li key={t.tradition} className="inline-flex items-center gap-1 rounded-full border bg-surface-2 px-2.5 py-0.5 text-xs font-medium">
                    {t.label} <b className="tabular-nums">{t.items.length}</b>
                  </li>
                ))}
              </ul>
              )
            }
          >
            Faith communities <span className="font-normal text-muted-foreground">· {groupCount}</span>
          </SubHead>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {traditions.flatMap((t) =>
              t.items.map((v) => (
                <ListingCard key={`${v.listing.org}|${v.listing.name ?? ""}|${v.listing.url ?? ""}`} view={v} icon={TRADITION_ICONS[t.tradition]} kicker={t.label} card />
              ))
            )}
          </div>
        </div>
      )}

      {comp && (
        <div className={cn((hasFacts || traditions.length > 0) && "mt-6 border-t pt-5")}>
          <SubHead tip={<InfoTip term="religious-composition" cited={citePage(comp, school.name, "Students by religious affiliation")} />}>
            Students by religious affiliation
            {[comp.population, comp.as_of].filter(Boolean).length ? <span className="font-normal text-muted-foreground"> ({[comp.population, comp.as_of].filter(Boolean).join(", ")})</span> : null}
          </SubHead>
          <ol className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {compItems.map((i) => (
              <li key={i.label} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{i.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {i.share !== null && <b>{`${(i.share * 100).toFixed(i.share < 0.1 ? 1 : 0)}%`}</b>}
                    {i.count !== null && <span className="ml-1 text-xs text-muted-foreground">{countLabel(i.count)}</span>}
                  </span>
                </div>
                {i.share !== null && (
                  <span className="mt-1 block h-1.5 rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (i.share / maxShare) * 100)}%`, backgroundColor: color }} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
