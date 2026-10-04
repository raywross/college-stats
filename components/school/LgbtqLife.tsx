import type { ReactElement, ReactNode } from "react";
import { CircleCheck, CircleMinus, Landmark, Rainbow, Users } from "lucide-react";
import type { School } from "@/lib/types";
import type { SchoolDetail } from "@/lib/detail";
import type { Cited } from "@/lib/lineage";
import { WITHHELD_TEXT, ZERO_TEXT, countDisplay, countText, longDate, smallCount } from "@/lib/lgbtq";
import { citeListing, listingsFor, readLabel, type CreditedListing, type PolicyKey } from "@/lib/directories";
import { policyChecklist, type ChecklistItem } from "@/lib/lgbtq-policy";
import { citePage, isFresh, policyRows } from "@/lib/campus-pages";
import { listingView } from "@/lib/campus-view";
import { loadOrganizations, orgWebsite } from "@/lib/organizations";
import { num, pctSmart } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import type { TermKey } from "@/lib/glossary";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { BLOCK_SCROLL } from "@/components/profile/Panel";
import { cn } from "@/lib/utils";
import { ListingCard, OrgBadge, OutLink, SubHead } from "./CampusListing";
import { LgbtqPolicies } from "./CampusPages";

/** A glossary term for the checklist items that have a dedicated one; the rest fall back to the general term. */
const POLICY_TERMS: Partial<Record<PolicyKey, TermKey>> = {
  inclusive_housing: "gender-inclusive-housing",
  name_on_records: "chosen-name-policy",
  nondiscrimination_identity: "nondiscrimination-policy",
};

const color = DOMAINS.size.color;

/** A center's card: the rainbow tile, the center's name linked to its own site, and what the list says of it. */
function CenterCard({ name, href, detail, tip }: { name: string; href: string | null; detail?: string | null; tip: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border bg-surface-2/60 p-3">
      <OrgBadge badge={{ kind: "none" }} icon={Rainbow} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-semibold">
          <span className="min-w-0">{href ? <OutLink href={href}>{name}</OutLink> : name}</span>
          {" "}{tip}
        </p>
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

/** One checklist line: a check (or, for a "no" the college's own page states, a minus), the policy, and its ⓘ. */
function PolicyItem({ item, school }: { item: ChecklistItem; school: School }) {
  const cited: Cited = item.listing ? citeListing(item.listing) : citePage({ url: item.url, checked: item.date, quote: item.quote ?? "" }, school.name, item.label);
  const term = POLICY_TERMS[item.key];
  const yes = item.value === "yes";
  return (
    <li className="flex items-start gap-2 text-sm">
      {yes ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0" style={{ color }} aria-label="Yes" />
      ) : (
        <CircleMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="No" />
      )}
      <span className="min-w-0">
        {item.label}
        {!yes && <span className="text-muted-foreground">: not offered, the college&apos;s own page says</span>}{" "}
        {term ? <InfoTip term={term} cited={cited} className="align-[-2px]" /> : <SourceTip cited={cited} className="align-[-2px]" />}
      </span>
    </li>
  );
}

/**
 * LGBTQ+ life (specs/lgbtq-life.md), facts first: support on campus (a center, from the college's own page or the
 * Consortium's list, and student groups national organizations list) as cards; the policy checklist with check marks
 * (only what a list or the college's own page says; a key nobody names is left out, never shown as "No"), credited in
 * one line to the list that names them; the conduct-code quote; the state law for public colleges as a callout; then
 * the federal another-gender counts. Describes; never ranks or compares. Hidden when there's nothing to show.
 */
export function LgbtqLife({
  school,
  detail,
  citedGender,
  citedAdmissions,
  citedLaw,
}: {
  school: School;
  detail: SchoolDetail | null;
  /** citeField("lgbtq.gender", school) */
  citedGender: Cited;
  /** citeField("lgbtq.admissions", school) */
  citedAdmissions: Cited;
  /** citeField("lgbtq.state_law", school) */
  citedLaw: Cited;
}) {
  const g = school.lgbtq?.gender ?? null;
  const a = school.lgbtq?.admissions ?? null;
  const law = school.lgbtq?.state_law ?? null;
  const listings = listingsFor(detail?.tables.directories?.rows, "lgbtq");
  const orgs = loadOrganizations().organizations;
  const groups = listings.filter((l) => l.credit.domain === "lgbtq" && l.credit.kind === "group").map((l) => listingView(l, orgs));
  const checklist = policyChecklist(school.lgbtq, listings);
  // A college-page center (tier A, checked by the campus pilot) replaces a Consortium-list center (tier D) for the
  // same college rather than showing both — one place for "is there a center".
  const now = new Date().toISOString().slice(0, 10);
  const pageCenter = detail?.tables.campus_pages?.rows.lgbtq?.center;
  const freshPageCenter = pageCenter && isFresh(pageCenter.checked, now) ? pageCenter : null;
  const centers = freshPageCenter ? [] : listings.filter((l) => l.credit.domain === "lgbtq" && l.credit.kind === "center");
  const hasConduct = policyRows(detail?.tables.campus_pages?.rows ?? null, now).some((p) => p.key === "conduct_restriction" && p.value === "yes");
  if (!g && !law && !freshPageCenter && !centers.length && !groups.length && !checklist.length && !hasConduct) return null;
  const another = g ? countDisplay(g.status, g.another, g.undergrads) : null;
  const unknown = g ? smallCount(g.unknown) : null;
  const showAdmissions = a && a.status !== "not_collected";
  const admissionsZero = a?.status === "reported" && !a.applicants && !a.admitted && !a.enrolled;
  const year = (c: Cited) => (c.year ? `, ${c.year.toLowerCase()}` : "");
  const hasSupport = !!freshPageCenter || centers.length > 0 || groups.length > 0;

  // The lists behind the tier D checklist items, credited once each under the list (owner decision 4: name, date, link).
  const credits = new Map<string, CreditedListing>();
  for (const i of checklist) if (i.listing && !credits.has(i.listing.credit.organization)) credits.set(i.listing.credit.organization, i.listing);
  const sections: ReactElement[] = [];

  if (hasSupport) {
    sections.push(
      <div key="support">
        <SubHead icon={Users} tip={<InfoTip term="lgbtq-resource-center" />}>
          Support on campus
        </SubHead>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {freshPageCenter && (
            <CenterCard
              name={freshPageCenter.name}
              href={freshPageCenter.url}
              detail={freshPageCenter.status === "closed" ? `Closed${freshPageCenter.closed ? ` (${freshPageCenter.closed})` : ""}` : "LGBTQ+ center or office"}
              tip={<SourceTip cited={citePage(freshPageCenter, school.name, "LGBTQ+ center or office")} />}
            />
          )}
          {centers.map((l) => (
            <CenterCard
              key={`${l.org}|${l.url ?? ""}`}
              name={l.name ?? "LGBTQ+ center or office"}
              href={l.url ?? null}
              detail={[l.name ? "LGBTQ+ center or office" : null, l.fact ? l.fact.replace(/^./, (c) => c.toUpperCase()) : null].filter(Boolean).join(" · ") || null}
              tip={<SourceTip cited={citeListing(l)} />}
            />
          ))}
          {groups.map((v) => (
            <ListingCard key={`${v.listing.org}|${v.listing.name ?? ""}`} view={v} icon={Users} card />
          ))}
        </div>
      </div>
    );
  }

  if (checklist.length > 0) {
    sections.push(
      <div key="policies">
        <SubHead icon={Landmark} tip={<InfoTip term="trans-policy-clearinghouse" />}>
          Policies
        </SubHead>
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {checklist.map((item) => (
            <PolicyItem key={item.key} item={item} school={school} />
          ))}
        </ul>
        {[...credits.values()].map((l) => {
          const site = orgs[l.org] ? orgWebsite(orgs[l.org], l.credit) : `${new URL(l.credit.list_url).origin}/`;
          return (
            <p key={l.credit.organization} className="mt-3 text-xs text-muted-foreground">
              Listed by {site ? <OutLink href={site}>{l.credit.organization}</OutLink> : l.credit.organization}, read {readLabel(l.credit.read)}; not confirmed by the college.
            </p>
          );
        })}
      </div>
    );
  }

  if (hasConduct) sections.push(<LgbtqPolicies key="conduct" school={school} detail={detail} bare />);

  if (law) {
    sections.push(
      <div key="law" className="rounded-2xl p-4" style={{ backgroundColor: `color-mix(in oklch, ${color} 8%, transparent)` }}>
        <p className="flex items-center gap-1.5 text-xs font-bold tracking-[0.14em] text-foreground/70 uppercase">
          <Landmark className="size-4" style={{ color }} aria-hidden /> State law for public colleges <InfoTip term="state-law-public-colleges" cited={citedLaw} />
        </p>
        <p className="mt-2 text-sm">{law.summary}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          <OutLink href={law.url}>{law.statute}</OutLink> ({law.name}), in effect since {longDate(law.effective)}.
          {centers.length > 0 && " Lists can lag changes on campus, so a center listed above may have changed since the list was read."}
        </p>
      </div>
    );
  }

  if (g && another) {
    sections.push(
      <div key="counts" className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            Undergraduates of another gender{year(citedGender)} <InfoTip term="another-gender" cited={citedGender} />
          </p>
          {another.kind === "count" ? (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-3xl font-extrabold">{num(another.count)}</span>
              {another.share !== null && <span className="text-sm text-muted-foreground">{pctSmart(another.share)} of undergrads</span>}
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold">{countText(another, "undergraduates")}</p>
          )}
          {unknown !== null && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              Gender unknown: {unknown} <InfoTip term="gender-unknown" cited={citedGender} />
            </p>
          )}
        </div>
        {showAdmissions && (
          <div>
            <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              First-year applicants of another gender{year(citedAdmissions)} <InfoTip term="another-gender" cited={citedAdmissions} />
            </p>
            <p className="mt-1 text-sm font-semibold">
              {a.status === "withheld"
                ? WITHHELD_TEXT
                : admissionsZero
                  ? ZERO_TEXT
                  : [
                      ["applied", a.applicants],
                      ["admitted", a.admitted],
                      ["enrolled", a.enrolled],
                    ]
                      .filter(([, n]) => n !== null)
                      .map(([label, n]) => `${smallCount(n as number)} ${label}`)
                      .join(" · ")}
            </p>
          </div>
        )}
        <p className="text-xs text-muted-foreground sm:col-span-2">Colleges record gender so differently that these counts can&apos;t be compared between colleges.</p>
      </div>
    );
  }

  return (
    <div id="lgbtq" className={cn("rounded-3xl border bg-card p-4 sm:p-6", BLOCK_SCROLL)}>
      <h3 className="mb-5 font-display text-lg font-bold">LGBTQ+ life</h3>
      <div className="space-y-6">
        {sections.map((s, i) => (
          <div key={s.key} className={cn(i > 0 && s.key !== "law" && "border-t pt-5")}>
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
