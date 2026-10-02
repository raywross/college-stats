import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import { isShown } from "@/lib/outcome-measures";
import { num, pct, pctSmart } from "@/lib/format";
import { InfoTip, SourceChip } from "@/components/ui/info-tip";

/**
 * Transfers in and out (specs/data-expansion/transfers.md). The two halves come from different files and years, so each
 * carries its own year and citation: transfer-ins are this fall's count (IPEDS EF{Y}A); transfer-outs are the share of
 * an entering class enrolled at another college 8 years later (IPEDS Outcome Measures), never an annual count.
 */
export function Transfers({
  school,
  citedIn,
  citedOut,
  rank,
  id,
}: {
  id?: string;
  school: School;
  /** citeField("demographics.transfer_in", school) */
  citedIn: Cited;
  /** citeField("outcomes.eight_year", school) */
  citedOut: Cited;
  /** Percentile rank of the transfer share (rankOf "transferShare"). */
  rank: number | null;
}) {
  const t = school.demographics.transfer_in;
  const o = school.outcomes?.eight_year;
  const out = o && isShown(o.all) ? o.all : null;
  if (!t && !out) return null;
  const leftCount = out ? Math.round(out.transferred * out.cohort) : null;

  return (
    <div id={id} className="rounded-3xl border bg-card p-4 sm:p-6 lg:col-span-2">
      <h3 className="mb-4 flex items-center gap-1 font-display text-lg font-bold">
        Transfers in and out <InfoTip term="transfer-in" />
      </h3>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Transferring in{citedIn.year ? `, ${citedIn.year.toLowerCase()}` : ""} <SourceChip cited={citedIn} />
          </p>
          {t ? (
            <>
              <p className="mt-2 font-display text-3xl font-extrabold">{num(t.count)}</p>
              <p className="mt-1 text-sm">
                new transfer students
                {t.share_of_new !== null && (
                  <>
                    , <b>{pctSmart(t.share_of_new)}</b> of new undergraduates
                  </>
                )}
                .
                {rank !== null && t.share_of_new !== null && (
                  <span className="text-muted-foreground"> A larger transfer share than at {pct(rank)} of colleges.</span>
                )}
              </p>
              {t.count > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {num(t.full_time)} full-time, {num(t.part_time)} part-time.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Not reported.</p>
          )}
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Going on to another college <InfoTip term="transfer-out" cited={citedOut} />
          </p>
          {out && o ? (
            <>
              <p className="mt-2 font-display text-3xl font-extrabold">{pctSmart(out.transferred)}</p>
              <p className="mt-1 text-sm">
                of students who entered in fall {o.entering_year} had left without a degree and were enrolled at another college 8 years later
                {leftCount !== null && leftCount > 0 && <span className="text-muted-foreground"> (about {num(leftCount)} students)</span>}.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Federal data doesn&apos;t count students leaving in a given year; this follows one entering class.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Not reported, or fewer than 30 students in the class.</p>
          )}
        </div>
      </div>
    </div>
  );
}
