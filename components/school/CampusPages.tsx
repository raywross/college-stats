import { Building2, CalendarDays, Home, Quote, Users } from "lucide-react";
import { citePage, greekCouncils, isFresh, countLabel, policyLabel, policyRows, type CampusPagesRows } from "@/lib/campus-pages";
import type { SchoolDetail } from "@/lib/detail";
import type { School } from "@/lib/types";
import { DOMAINS } from "@/lib/metrics";
import { InfoTip, SourceTip } from "@/components/ui/info-tip";

/**
 * Facts read from the college's own pages by the campus-life pilot (lib/campus-pages.ts): each one quiet, with its page,
 * date checked, and quote in its ⓘ. Facts older than two years are hidden (isFresh); every block is hidden when empty.
 * Three blocks, one per domain, so each domain's owner can move its block inside its own card:
 * - `GreekCouncils` (council breakdown, recruitment, chapter houses) belongs inside GreekLife;
 * - `FaithFacts` (the religious-life office and the college's own religious composition) beside ReligiousLife;
 * - `LgbtqPolicies` (center, policy items, and the conduct-code quote) beside LgbtqLife.
 */

const today = () => new Date().toISOString().slice(0, 10);
const rowsOf = (detail: SchoolDetail | null): CampusPagesRows | null => detail?.tables.campus_pages?.rows ?? null;
const card = "mt-4 rounded-3xl border bg-card p-4 sm:p-6";

/** The council breakdown subcomponent (greek-life.md Measures 2–4). Renders inside a parent card when `bare`. */
export function GreekCouncils({ school, detail, bare = false }: { school: School; detail: SchoolDetail | null; bare?: boolean }) {
  const rows = rowsOf(detail);
  const now = today();
  const b = greekCouncils(rows, now);
  const g = rows?.greek;
  const fresh = <T extends { checked: string }>(r: T | undefined) => (r && isFresh(r.checked, now) ? r : undefined);
  const deferred = fresh(g?.deferred);
  const formal = fresh(g?.formal_term);
  const housing = fresh(g?.housing);
  const none = fresh(g?.none_stated);
  if (!b && !deferred && !formal && !housing && !none) return null;
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
            <Users className="size-4" style={{ color }} /> Members by council{b.term ? `, ${b.term}` : ""} <InfoTip term="greek-council" />
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Council</th>
                <th className="py-1 text-right font-medium">Chapters</th>
                <th className="py-1 text-right font-medium">Members</th>
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
                  <td className="py-1.5 text-right tabular-nums">{r.members ?? "—"}</td>
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
  if (bare) return <div className="mt-5">{body}</div>;
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
export function FaithFacts({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const f = rowsOf(detail)?.faith;
  const now = today();
  const office = f?.office && isFresh(f.office.checked, now) ? f.office : null;
  const comp = f?.composition && isFresh(f.composition.checked, now) ? f.composition : null;
  if (!office && !comp) return null;
  const color = DOMAINS.size.color;
  const items = comp ? [...comp.items].sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (b.count ?? 0) - (a.count ?? 0)) : [];
  return (
    <div id="faith-pages" className={card}>
      <h3 className="mb-4 flex items-center gap-1.5 font-display text-lg font-bold">
        Religious life, from the college <InfoTip term="college-page-fact" />
      </h3>
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
    </div>
  );
}

/** The LGBTQ+ center, policy items, and the conduct-code quote (lgbtq-life.md Measures 2–4). Describes; never grades. */
export function LgbtqPolicies({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const rows = rowsOf(detail);
  const now = today();
  const center = rows?.lgbtq?.center && isFresh(rows.lgbtq.center.checked, now) ? rows.lgbtq.center : null;
  const policies = policyRows(rows, now);
  const items = policies.filter((p) => p.key !== "conduct_restriction");
  const conduct = policies.find((p) => p.key === "conduct_restriction" && p.value === "yes");
  if (!center && !items.length && !conduct) return null;
  const ref = (p: (typeof policies)[number]) => ({ url: p.url, checked: p.checked, quote: p.quote ?? "", verified_by: p.verified_by });
  return (
    <div id="lgbtq-pages" className={card}>
      <h3 className="mb-4 flex items-center gap-1.5 font-display text-lg font-bold">
        LGBTQ+ policies and support, from the college <InfoTip term="lgbtq-policies" />
      </h3>
      {center && (
        <p className="mb-3 flex items-center gap-1.5 text-sm">
          <Building2 className="size-4" style={{ color: DOMAINS.size.color }} />
          {center.status === "open" ? center.name : `${center.name}: closed${center.closed ? ` (${center.closed})` : ""}`}
          <SourceTip cited={citePage(center, school.name, "LGBTQ+ center or office")} />
        </p>
      )}
      {items.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {items.map((p) => (
            <li key={p.key} className="flex items-start gap-1.5">
              <span className="w-8 shrink-0 font-semibold">{p.value === "yes" ? "Yes" : "No"}</span>
              <span>{policyLabel(p.key)}</span>
              <SourceTip cited={citePage(ref(p), school.name, policyLabel(p.key))} className="mt-0.5" />
            </li>
          ))}
        </ul>
      )}
      {conduct && (
        <div className="mt-4">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            What the student conduct policy says <InfoTip term="conduct-code-restriction" cited={citePage(ref(conduct), school.name, "What the student conduct policy says")} />
          </p>
          <blockquote className="flex gap-2 border-l-2 pl-3 text-sm italic">
            <Quote className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {conduct.quote}
          </blockquote>
        </div>
      )}
    </div>
  );
}
