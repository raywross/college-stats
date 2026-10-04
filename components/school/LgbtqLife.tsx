import { ExternalLink, Landmark, Users } from "lucide-react";
import type { School } from "@/lib/types";
import type { SchoolDetail } from "@/lib/detail";
import type { Cited } from "@/lib/lineage";
import { WITHHELD_TEXT, ZERO_TEXT, countDisplay, countText, longDate, smallCount } from "@/lib/lgbtq";
import { citeListing, listingsFor, type PolicyKey } from "@/lib/directories";
import { policyChecklist } from "@/lib/lgbtq-policy";
import { citePage, isFresh, policyRows } from "@/lib/campus-pages";
import { num, pctSmart } from "@/lib/format";
import { DOMAINS } from "@/lib/metrics";
import type { TermKey } from "@/lib/glossary";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";
import { CreditedList } from "./CreditedList";
import { LgbtqPolicies } from "./CampusPages";

/** A glossary term for the checklist items that have a dedicated one; the rest fall back to the general term. */
const POLICY_TERMS: Partial<Record<PolicyKey, TermKey>> = {
  inclusive_housing: "gender-inclusive-housing",
  name_on_records: "chosen-name-policy",
  nondiscrimination_identity: "nondiscrimination-policy",
};

/**
 * LGBTQ+ life (specs/lgbtq-life.md). Phase 1 (built): the federal another-gender counts and, at public colleges in a
 * state with one, the state law. Phase 3 (built here): "Support on campus" (a center or staffed office and student
 * groups the Consortium or another national list credits, tier B/D) and the policy checklist (a national list's lead,
 * tier D, or — once the pilot track checks the college's own page — a tier A fact that replaces it for the same key;
 * lib/lgbtq-policy.ts `policyChecklist`). Describes; never ranks or compares. Hidden when there's nothing to show.
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
  const groups = listings.filter((l) => l.credit.domain === "lgbtq" && l.credit.kind === "group");
  const checklist = policyChecklist(school.lgbtq, listings);
  // A college-page center (tier A, checked by the campus pilot) replaces a Consortium-list center (tier D) for the
  // same college rather than showing both — one place for "is there a center" (specs/lgbtq-life.md "Where it
  // appears"; this integration pass).
  const now = new Date().toISOString().slice(0, 10);
  const pageCenter = detail?.tables.campus_pages?.rows.lgbtq?.center;
  const freshPageCenter = pageCenter && isFresh(pageCenter.checked, now) ? pageCenter : null;
  const centers = freshPageCenter ? [] : listings.filter((l) => l.credit.domain === "lgbtq" && l.credit.kind === "center");
  const hasConduct = policyRows(detail?.tables.campus_pages?.rows ?? null, now).some((p) => p.key === "conduct_restriction" && p.value === "yes");
  if (!g && !law && !freshPageCenter && !centers.length && !groups.length && !checklist.length && !hasConduct) return null;
  const another = g ? countDisplay(g.status, g.another, g.undergrads) : null;
  const unknown = g ? smallCount(g.unknown) : null;
  // Applicants: shown when the college reported them or withheld them; "not collected" is already said above.
  const showAdmissions = a && a.status !== "not_collected";
  const admissionsZero = a?.status === "reported" && !a.applicants && !a.admitted && !a.enrolled;
  const year = (c: Cited) => (c.year ? `, ${c.year.toLowerCase()}` : "");

  return (
    <div id="lgbtq" className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="mb-5 font-display text-lg font-bold">LGBTQ+ life</h3>
      {(freshPageCenter || centers.length > 0 || groups.length > 0) && (
        <div className="mb-5">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Users className="size-4" style={{ color: DOMAINS.size.color }} /> Support on campus <InfoTip term="lgbtq-resource-center" />
          </p>
          {freshPageCenter && (
            <p className="flex items-center gap-1.5 text-sm">
              {freshPageCenter.status === "open" ? freshPageCenter.name : `${freshPageCenter.name}: closed${freshPageCenter.closed ? ` (${freshPageCenter.closed})` : ""}`}
              <SourceTip cited={citePage(freshPageCenter, school.name, "LGBTQ+ center or office")} />
            </p>
          )}
          {centers.length > 0 && <CreditedList items={centers} className="space-y-1.5" />}
          {groups.length > 0 && <CreditedList items={groups} className="mt-1.5 space-y-1.5" />}
          {!freshPageCenter && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Directories lag closures: a listed center may have since closed, especially under a state law like the one below.
            </p>
          )}
        </div>
      )}
      {checklist.length > 0 && (
        <div className="mb-5">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Landmark className="size-4" style={{ color: DOMAINS.size.color }} aria-hidden /> Policies <InfoTip term="trans-policy-clearinghouse" />
          </p>
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item.key} className="flex items-start gap-1.5 text-sm">
                <span className="min-w-0">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-4 hover:text-primary">
                    {item.text}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </span>
                {item.listing ? (
                  <SourceTip cited={citeListing(item.listing)} className="mt-0.5" />
                ) : (
                  POLICY_TERMS[item.key] && <InfoTip term={POLICY_TERMS[item.key]!} className="mt-0.5" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <LgbtqPolicies school={school} detail={detail} bare />
      {g && another && (
        <div className="grid gap-6 border-t pt-4 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Undergraduates of another gender{year(citedGender)} <InfoTip term="another-gender" cited={citedGender} />
            </p>
            {another.kind === "count" ? (
              <>
                <p className="mt-2 font-display text-3xl font-extrabold">{num(another.count)}</p>
                {another.share !== null && <p className="mt-1 text-sm">{pctSmart(another.share)} of all undergraduates</p>}
              </>
            ) : (
              <p className="mt-2 text-sm font-semibold">{countText(another, "undergraduates")}</p>
            )}
            {unknown !== null && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                Gender unknown: {unknown} <InfoTip term="gender-unknown" cited={citedGender} />
              </p>
            )}
          </div>
          {showAdmissions && (
            <div>
              <p className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                First-year applicants of another gender{year(citedAdmissions)} <InfoTip term="another-gender" cited={citedAdmissions} />
              </p>
              <p className="mt-2 text-sm">
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
        </div>
      )}
      {g && (
        <p className="mt-4 text-xs text-muted-foreground">
          All undergraduates whose college records hold a gender other than man or woman. It doesn&apos;t count transgender
          students overall or describe sexual orientation, and colleges record it so differently that numbers can&apos;t be
          compared between colleges. The federal survey has since stopped asking for it.
        </p>
      )}
      {law && (
        <div className={g || centers.length > 0 || checklist.length > 0 ? "mt-5 border-t pt-4" : ""}>
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Landmark className="size-4" style={{ color: DOMAINS.size.color }} aria-hidden /> State law for public colleges{" "}
            <InfoTip term="state-law-public-colleges" cited={citedLaw} />
          </p>
          <p className="mt-2 text-sm">{law.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <a href={law.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
              {law.statute}
            </a>{" "}
            ({law.name}), in effect since {longDate(law.effective)}.
          </p>
          {centers.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              A center listed above isn&apos;t a claim that it&apos;s still open: this law can close offices like it after a list was last read.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
