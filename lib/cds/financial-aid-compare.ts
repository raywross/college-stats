/**
 * Compare's "All the numbers" rows for CDS financial aid (specs/data-expansion/cds-financial-aid.md#compare): the
 * "Financial aid process" rows. "–" when null (never "No"); the aid-year figures are left out when the college's aid
 * year is two or more years older than the federal aid year (`cdsAidYearNote`). No key differences, no radar axis.
 */
import type { FieldPath } from "../fields";
import type { TermKey } from "../glossary";
import type { School } from "../types";
import { money, moneyCompact, pct } from "../format.ts";
import { cdsAidYearNote, formatAidDay, meritDollarShare } from "./financial-aid.ts";

export type CompareAidRow = readonly [string, TermKey, FieldPath, (s: School) => string | null];

/** The rows, given the federal aid year (`citeField("aid.cohort").year`, e.g. "2023–24"). */
export function compareAidRows(sfaYear: string | null): CompareAidRow[] {
  const shown = (s: School) => cdsAidYearNote(s.reported?.aid?.aid_year ?? null, sfaYear).show;
  return [
    ["Aid forms", "css-profile", "reported.aid.forms", (s) => {
      const f = s.reported?.aid?.forms;
      if (!f) return null;
      return [f.fafsa && "FAFSA", f.css_profile && "CSS Profile", f.noncustodial_profile && "Noncustodial", f.own_form && "College's own form", f.business_farm_supplement && "Business/Farm"].filter(Boolean).join(" · ") || null;
    }],
    ["Aid priority date or deadline", "need-based-aid", "reported.aid.dates", (s) => {
      const d = s.reported?.aid?.dates;
      const p = d?.priority && d.priority !== "unstated" ? d.priority : null;
      const dl = d?.deadline && d.deadline !== "unstated" ? d.deadline : null;
      return p ? `${formatAidDay(p)} (priority)` : dl ? `${formatAidDay(dl)} (deadline)` : null;
    }],
    ["Need met, first-years", "need-met", "reported.aid.first_years", (s) => {
      const i = s.reported?.aid?.first_years?.i ?? null;
      return i === null || !shown(s) ? null : pct(i);
    }],
    ["Average aid package, first-years", "aid-package", "reported.aid.first_years", (s) => {
      const j = s.reported?.aid?.first_years?.j ?? null;
      return j === null || !shown(s) ? null : money(j);
    }],
    ["College grant dollars given as merit", "merit-dollar-share", "derived.merit_dollar_share", (s) => {
      const m = meritDollarShare(s.reported?.aid?.institutional_grants);
      return m === null || !shown(s) ? null : pct(m);
    }],
    ["Aid for international students", "aid-for-international-students", "reported.aid.international", (s) => {
      const x = s.reported?.aid?.international;
      if (!x || !shown(s)) return null;
      if (x.none) return "Not offered";
      if (x.recipients !== null && x.average !== null) return `${x.recipients.toLocaleString("en-US")} students, average ${moneyCompact(x.average)}`;
      return x.need_based || x.non_need ? "Offered" : null;
    }],
  ];
}
