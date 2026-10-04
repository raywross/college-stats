import { Building2, CalendarDays, Home, Quote, Users } from "lucide-react";
import { citePage, greekCouncils, hasGreekPageFacts, isFresh, countLabel, policyRows, type CampusPagesRows } from "@/lib/campus-pages";
import type { SchoolDetail } from "@/lib/detail";
import type { School } from "@/lib/types";
import { DOMAINS } from "@/lib/metrics";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";

/**
 * Facts read from the college's own pages by the campus-life pilot (lib/campus-pages.ts): each one quiet, with its page,
 * date checked, and quote in its ⓘ. Facts older than two years are hidden (isFresh); every block is hidden when empty.
 * Three subcomponents, one per domain, each rendered `bare` *inside* its domain's own card rather than as a separate
 * one, so a college's own page and the national-directory leads for the same domain read as one coherent block with
 * one heading (2026-10-04 integration pass):
 * - `GreekCouncils` (council breakdown, recruitment, chapter houses) renders inside GreekLife's card.
 * - `FaithFacts` (the religious-life office and the college's own religious composition) renders inside ReligiousLife's.
 * - `LgbtqPolicies` — now only the conduct-code quote, since the policy items and the center moved into LgbtqLife's
 *   own "Policies" checklist and "Support on campus" (lib/lgbtq-policy.ts `policyChecklist` already prefers a tier A
 *   fact over a tier D lead for the same key; a college-page center replaces a Consortium-list center the same way) —
 *   renders inside LgbtqLife's card.
 */

const today = () => new Date().toISOString().slice(0, 10);
const rowsOf = (detail: SchoolDetail | null): CampusPagesRows | null => detail?.tables.campus_pages?.rows ?? null;
const card = "mt-4 rounded-3xl border bg-card p-4 sm:p-6";

/** The council breakdown subcomponent (greek-life.md Measures 2–4). Renders inside a parent card when `bare`. */
export function GreekCouncils({ school, detail, bare = false }: { school: School; detail: SchoolDetail | null; bare?: boolean }) {
  const rows = rowsOf(detail);
  const now = today();
  if (!hasGreekPageFacts(rows, now)) return null;
  const b = greekCouncils(rows, now);
  // A Members column only when the college's pages give members for some council (most give chapters only).
  const hasMembers = !!b?.rows.some((r) => r.members != null);
  const g = rows?.greek;
  const fresh = <T extends { checked: string }>(r: T | undefined) => (r && isFresh(r.checked, now) ? r : undefined);
  const deferred = fresh(g?.deferred);
  const formal = fresh(g?.formal_term);
  const housing = fresh(g?.housing);
  const none = fresh(g?.none_stated);
  const color = DOMAINS.size.color;

  const body = (
    <>
      {none && (
        <p className="flex items-center gap-1.5 text-sm">
          No fraternities or sororities, the college says.
          <SourceTip cited={citePage(none, school.name, "No fraternities or sororities")} />
        </p>
      )}
      {b && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Users className="size-4" style={{ color }} /> {hasMembers ? "Members by council" : "Chapters by council"}{b.term ? `, ${b.term}` : ""} <InfoTip term="greek-council" />
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Council</th>
                <th className="py-1 pl-3 text-right font-medium">Chapters</th>
                {hasMembers && <th className="py-1 pl-3 text-right font-medium">Members</th>}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={`${r.council}|${r.name}`} className="border-t">
                  <td className="py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1">
                      {r.name}
                      <SourceTip cited={citePage(r.ref, school.name, `${r.name}${r.term ? `, ${r.term}` : ""}`)} />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {r.label}
                      {!b.term && r.term ? `, ${r.term}` : ""}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.chapters ?? "—"}</td>
                  {hasMembers && <td className="py-1.5 pl-3 text-right tabular-nums">{r.members ?? "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {b.total && b.totalRef && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              {b.total} members in all{b.totalRef.term ? `, ${b.totalRef.term}` : ""}, as the college states it.
              <SourceTip cited={citePage(b.totalRef, school.name, "Fraternity and sorority members")} />
            </p>
          )}
        </div>
      )}
      {(deferred || formal || housing) && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {formal && (
            <li className="flex items-center gap-1.5">
              <CalendarDays className="size-4 shrink-0" style={{ color }} /> Formal recruitment: {formal.value}
              <SourceTip cited={citePage(formal, school.name, "Formal recruitment")} />
            </li>
          )}
          {deferred && (
            <li className="flex items-center gap-1.5">
              <CalendarDays className="size-4 shrink-0" style={{ color }} />
              {deferred.value === "yes" ? "Deferred recruitment: first-years join after their first term" : "First-years can join in their first term"}
              <InfoTip term="deferred-recruitment" cited={citePage(deferred, school.name, "Deferred recruitment")} />
            </li>
          )}
          {housing && (
            <li className="flex items-center gap-1.5">
              <Home className="size-4 shrink-0" style={{ color }} />
              {housing.value === "yes" ? "Chapter houses" : "No chapter houses"}
              <SourceTip cited={citePage(housing, school.name, "Chapter houses")} />
            </li>
          )}
        </ul>
      )}
    </>
  );
  if (bare) {
    return (
      <div className="mt-5 border-t pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          From the college&apos;s own pages <InfoTip term="college-page-fact" />
        </p>
        {body}
      </div>
    );
  }
  return (
    <div id="greek-councils" className={card}>
      <h3 className="mb-4 flex items-center gap-1.5 font-display text-lg font-bold">
        Fraternities and sororities, from the college <InfoTip term="college-page-fact" />
      </h3>
      {body}
    </div>
  );
}

/** The religious-life office and the college's own religious composition (religious-life.md Measures 3–4). */
export function FaithFacts({ school, detail, bare = false }: { school: School; detail: SchoolDetail | null; bare?: boolean }) {
  const f = rowsOf(detail)?.faith;
  const now = today();
  const office = f?.office && isFresh(f.office.checked, now) ? f.office : null;
  const comp = f?.composition && isFresh(f.composition.checked, now) ? f.composition : null;
  if (!office && !comp) return null;
  const color = DOMAINS.size.color;
  const items = comp ? [...comp.items].sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (b.count ?? 0) - (a.count ?? 0)) : [];
  const body = (
    <>
      {office && (
        <p className="flex items-center gap-1.5 text-sm">
          <Building2 className="size-4" style={{ color }} />
          <a href={office.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-4 hover:text-primary">
            {office.name}
          </a>
          <SourceTip cited={citePage(office, school.name, "Office for religious life")} />
        </p>
      )}
      {comp && (
        <div className="mt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            Students by religious affiliation
            {[comp.population, comp.as_of].filter(Boolean).length ? ` (${[comp.population, comp.as_of].filter(Boolean).join(", ")})` : ""}
            <InfoTip term="religious-composition" cited={citePage(comp, school.name, "Students by religious affiliation")} />
          </p>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.label} className="flex justify-between gap-2 border-b py-1">
                <span>{i.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {i.share !== null ? `${(i.share * 100).toFixed(i.share < 0.1 ? 1 : 0)}%` : ""}
                  {i.count !== null ? `${i.share !== null ? " · " : ""}${countLabel(i.count)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
  if (bare) {
    return (
      <div className="mt-5 border-t pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          From the college&apos;s own pages <InfoTip term="college-page-fact" />
        </p>
        {body}
      </div>
    );
  }
  return (
    <div id="faith-pages" className={card}>
      <h3 className="mb-4 flex items-center gap-1.5 font-display text-lg font-bold">
        Religious life, from the college <InfoTip term="college-page-fact" />
      </h3>
      {body}
    </div>
  );
}

/**
 * The conduct-code quote (lgbtq-life.md Measures 3), under the spec's own neutral heading. Describes; never grades.
 * The center and the policy checklist moved to `LgbtqLife` (components/school/LgbtqLife.tsx): a tier A center or
 * policy fact from the college's own page now replaces the matching tier D lead there instead of repeating it here
 * (lib/lgbtq-policy.ts `policyChecklist`), so this component only ever shows the one fact nothing else does.
 */
export function LgbtqPolicies({ school, detail, bare = false }: { school: School; detail: SchoolDetail | null; bare?: boolean }) {
  const rows = rowsOf(detail);
  const now = today();
  const conduct = policyRows(rows, now).find((p) => p.key === "conduct_restriction" && p.value === "yes");
  if (!conduct) return null;
  const ref = { url: conduct.url, checked: conduct.checked, quote: conduct.quote ?? "", verified_by: conduct.verified_by };
  const body = (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        What the student conduct policy says <InfoTip term="conduct-code-restriction" cited={citePage(ref, school.name, "What the student conduct policy says")} />
      </p>
      <blockquote className="flex gap-2 border-l-2 pl-3 text-sm italic">
        <Quote className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {conduct.quote}
      </blockquote>
    </div>
  );
  if (bare) return <div className="mt-5 border-t pt-4">{body}</div>;
  return (
    <div id="lgbtq-pages" className={card}>
      {body}
    </div>
  );
}
