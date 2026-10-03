import type { ReactNode } from "react";
import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { SchoolDetail } from "@/lib/detail";
import { cip4, cipTitle } from "@/lib/cip";
import { MAJOR_FAMILIES, majorFamilyName, programsFromRows, type FieldGrowth } from "@/lib/majors";
import { historyYearLabel } from "@/lib/history";
import { num, pct, pctSmart } from "@/lib/format";
import { InfoTip, Term } from "@/components/ui/info-tip";
import { MajorsList, type MajorRow } from "./MajorsList";

/**
 * Profile, Academics: "Most popular majors" (specs/data-expansion/majors.md). The snapshot's top 5 and total, every
 * program from the detail file (expandable, searchable; MajorsList), and the fastest-growing field from history. Titles
 * are resolved here on the server (lib/cip.ts is too big for the client).
 */
export function Majors({
  school,
  detail,
  cited,
  growth,
  growthNote,
  color,
  id,
}: {
  id?: string;
  school: School;
  detail: SchoolDetail | null;
  /** citeField("academics.majors_top", school) */
  cited: Cited;
  /** lib/majors.ts fastestGrowingField over the history window, or null. */
  growth: FieldGrowth | null;
  /** The growth line's history footnote (HistorySourceNote). */
  growthNote?: ReactNode;
  color: string;
}) {
  const a = school.academics;
  const total = a?.bachelors_awarded ?? null;
  const top = a?.majors_top ?? null;
  if (!top?.length || !total) return null;

  const programs = programsFromRows(detail?.tables.majors?.rows);
  // Earnings by major (field-of-study.md) are per 4-digit group, so every program in a group shows the group's figure.
  const earningsRows = detail?.tables.programs?.rows;
  const earnings4 = (cip: string) => {
    const c = cip4(cip);
    return c ? (earningsRows?.[c]?.earnings.y4 ?? null) : null;
  };
  const rows: MajorRow[] = programs.length
    ? programs.map((p) => ({ cip: p.cip, title: cipTitle(p.cip) ?? p.cip, family: majorFamilyName(p.cip), first: p.first, second: p.second, earnings4: earnings4(p.cip) }))
    : // Detail file unavailable (fail-soft): the snapshot's top 5 only. Counts from 4-place shares are exact under 10,000 graduates.
      top.map((m) => ({ cip: m.cip, title: m.title, family: majorFamilyName(m.cip), first: Math.round(m.share * total), second: 0, earnings4: earnings4(m.cip) }));
  const anyEarnings = rows.some((r) => r.earnings4 != null);
  const topShare = top.reduce((s, m) => s + m.share, 0);
  const fields = new Set(rows.filter((r) => r.first > 0).map((r) => r.cip.slice(0, 2))).size;

  return (
    <div id={id} className="rounded-3xl border bg-card p-4 sm:p-6 lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h3 className="flex items-center gap-1 font-display text-lg font-bold">
          Most popular majors <InfoTip term="first-major" cited={cited} />        </h3>
        <p className="text-sm text-muted-foreground">
          <b className="text-foreground">{num(total)}</b> bachelor&apos;s degrees{cited.year ? `, ${cited.year}` : ""}
        </p>
      </div>
      <p className="mb-4 max-w-3xl text-sm">
        The top {top.length} {top.length === 1 ? "program accounts" : "programs account"} for <b>{pct(topShare)}</b> of graduates
        {programs.length > 0 && (
          <span className="text-muted-foreground">
            ; {num(programs.filter((p) => p.first > 0).length)} programs in {fields} {fields === 1 ? "field" : "fields"} awarded at least one
          </span>
        )}
        .
      </p>

      <MajorsList rows={rows} total={total} color={color} />

      {growth && (
        <div className="mt-5 border-t pt-4">
          <p className="text-sm">
            <span className="text-muted-foreground">Fastest-growing field:</span> <b>{MAJOR_FAMILIES[growth.family]}</b>,{" "}
            <span className="tabular-nums">
              {pctSmart(growth.from.share)} → {pctSmart(growth.to.share)}
            </span>{" "}
            of graduates since {historyYearLabel(growth.from.year, "academic")} ({num(growth.graduates)} graduates in{" "}
            {historyYearLabel(growth.to.year, "academic")}).
          </p>
          {growthNote && <div className="mt-1.5">{growthNote}</div>}
        </div>
      )}

      <p className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>
          Bachelor&apos;s degrees awarded July through June, by federal program name (<Term term="cip-code">CIP code</Term>), which can differ from
          what the college calls a major. A double major counts once, under the <Term term="first-major">first major</Term>; its other field is a{" "}
          <Term term="second-major">second major</Term>.
          {anyEarnings && (
            <>
              {" "}
              Earnings are College Scorecard&apos;s median for graduates of the program&apos;s broader field (
              <Term term="field-of-study">4-digit CIP group</Term>), 4 years after completion; see Top-earning majors below.
            </>
          )}
        </span>
      </p>
    </div>
  );
}
