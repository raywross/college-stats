import type { CdsAid, H2Column, H2Line, School } from "@/lib/types";
import type { SchoolDetail } from "@/lib/detail";
import type { Cited } from "@/lib/lineage";
import type { TermKey } from "@/lib/glossary";
import { getData } from "@/lib/data";
import { H2_CODES, cdsAidYearNote, h2Shares, meritDollarShare, type H2ColumnKey } from "@/lib/cds/financial-aid";
import { money, num, pct } from "@/lib/format";
import { MetricLabel, SourceTip } from "@/components/ui/info-tip";

type Cell = { text: string; sub?: string; cited: Cited } | null;

/**
 * Cost page, "Who gets aid": the college's own Common Data Set H2/H2A, first-years beside all full-time
 * undergraduates (specs/data-expansion/cds-financial-aid.md#display). Reads `reported.aid` and `detail.cds_aid`; each
 * value's ⓘ quotes its own line of the document, and a full-time figure that replaced the hand-imported `aid.cds` says
 * so. Hidden when the aid year is two or more years older than the federal aid figures.
 */
export async function CdsAidTable({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const aid = school.reported?.aid;
  const rows = detail?.tables.cds_aid?.rows;
  if (!aid?.aid_year || !rows?.h2) return null;
  const { citeField } = await getData();
  const note = cdsAidYearNote(aid.aid_year, citeField("aid.cohort", school).year);
  if (!note.show) return null;

  const base = citeField("reported.aid.first_years", school);
  const prev = school.aid?.cds_previous;
  const prevYear = prev ? citeField("aid.cds_previous", school).year : null;
  const citeLine = (col: H2ColumnKey, line: H2Line, replaced?: { value: number | null; display: string | null }): Cited => {
    const c = rows.cite[H2_CODES[col][line]];
    return {
      ...base,
      ...(col === "full_time" ? { field: "Need and aid, all full-time undergraduates (CDS H2, H2A)" } : {}),
      ...(c ? { quote: c.quote } : {}),
      ...(col === "full_time" && prev && replaced && replaced.display !== null
        ? { replaces: { value: replaced.value, year: prevYear, label: `${school.name} Common Data Set`, display: replaced.display } }
        : {}),
    };
  };
  const old = (f: (v: CdsAid) => number | null, fmt: (n: number) => string) => {
    const v = prev ? f(prev.values) : null;
    return { value: v, display: v === null ? null : fmt(v) };
  };
  const share = (x: number | null, y: number | null) => (x === null || !y ? null : x / y);

  const fy: H2Column | null = rows.h2.first_years;
  const ft: H2Column | null = rows.h2.full_time;
  const cell = (col: H2ColumnKey, c: H2Column | null, line: H2Line, value: number | null, text: (v: number) => string, sub?: string | null, replaced?: ReturnType<typeof old>): Cell =>
    c && value !== null ? { text: text(value), ...(sub ? { sub } : {}), cited: citeLine(col, line, replaced) } : null;

  type Row = { label: string; term: TermKey; cells: [Cell, Cell] };
  const both = (f: (col: H2ColumnKey, c: H2Column | null) => Cell): [Cell, Cell] => [f("first_years", fy), f("full_time", ft)];
  const rowsAll: Row[] = [
    {
      label: "Have financial need",
      term: "need-based-aid",
      cells: both((k, c) => cell(k, c, "c", h2Shares(c).hasNeed, (v) => pct(v), c?.c != null ? `${num(c.c)} students` : null, old((v) => share(v.has_need, v.undergrads), (n) => pct(n)))),
    },
    { label: "Need met, on average", term: "need-met", cells: both((k, c) => cell(k, c, "i", c?.i ?? null, (v) => pct(v), null, old((v) => v.pct_need_met, (n) => pct(n)))) },
    { label: "Need fully met", term: "need-met", cells: both((k, c) => cell(k, c, "h", h2Shares(c).fullyMet, (v) => pct(v))) },
    { label: "Average aid package", term: "aid-package", cells: both((k, c) => cell(k, c, "j", c?.j ?? null, money, null, old((v) => v.avg_package, money))) },
    { label: "Average need-based grant", term: "need-based-aid", cells: both((k, c) => cell(k, c, "k", c?.k ?? null, money, null, old((v) => v.avg_need_grant, money))) },
    { label: "Average need-based loan", term: "self-help-aid", cells: both((k, c) => cell(k, c, "m", c?.m ?? null, money, null, old((v) => v.avg_need_loan, money))) },
    {
      label: "Merit aid without need",
      term: "merit-aid",
      cells: both((k, c) => cell(k, c, "n", h2Shares(c).meritNoNeed, (v) => pct(v), c?.o != null ? `average ${money(c.o)}` : null, old((v) => share(v.merit_no_need, v.undergrads), (n) => pct(n)))),
    },
    {
      label: "Athletic scholarships",
      term: "athletic-scholarship",
      cells: both((k, c) => (c?.p ? cell(k, c, "p", c.p, num, c.q != null ? `average ${money(c.q)}` : null) : null)),
    },
  ];
  const list = rowsAll.filter((r) => r.cells.some((x) => x !== null));
  if (!list.length) return null;

  const merit = meritDollarShare(aid.institutional_grants);

  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <h3 className="font-display text-lg font-bold">From {school.name}&apos;s Common Data Set</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        First-years and all full-time undergraduates, {base.year}
        {note.suffix}.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <th className="pb-2 font-semibold" />
            <th className="pb-2 text-right font-semibold">First-years</th>
            <th className="pb-2 pl-3 text-right font-semibold">All full-time</th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {list.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-2 pr-2 text-left text-xs font-medium text-muted-foreground">
                <MetricLabel term={r.term} cited={r.cells[0]?.cited ?? r.cells[1]?.cited}>
                  {r.label}
                </MetricLabel>
              </th>
              {r.cells.map((c, i) => (
                <td key={i} className={`py-2 text-right align-top ${i ? "pl-3" : ""}`}>
                  {c ? (
                    <>
                      <span className="inline-flex items-center gap-1 font-semibold">
                        {c.text}
                        {i === 1 && <SourceTip cited={c.cited} />}
                      </span>
                      {c.sub && <span className="block text-[11px] text-muted-foreground">{c.sub}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {merit !== null && (
        <p className="mt-4 text-sm">
          <MetricLabel term="merit-dollar-share" cited={citeField("derived.merit_dollar_share", school)}>
            <span>
              <b>{pct(merit)}</b> of the college&apos;s own grant dollars were awarded without regard to need.
            </span>
          </MetricLabel>
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Each college decides what a family needs, so &ldquo;100% of need met&rdquo; can mean different prices at different colleges. Merit awards that went toward a
        student&apos;s need count as need-based here.
      </p>
    </div>
  );
}
