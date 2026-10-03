import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { collegePrepSentence, completionSentence, showsHsPrep, unitRows } from "@/lib/cds/application-logistics-display";
import { Block } from "@/components/profile/Panel";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";

const units = (v: number | null) => (v === null ? "–" : String(v));

/**
 * "What you'll need in high school" (specs/data-expansion/cds-application-logistics.md): the completion and
 * college-prep requirement as sentences and the years of each subject required and recommended (CDS C3–C5). Shown only
 * when C5 has units; C3/C4 alone are too thin for a block.
 */
export function HsPrepBox({ school, cite, id }: { school: School; cite: (path: FieldPath, school?: School) => Cited; id?: string }) {
  const h = school.reported?.admissions_hs_prep;
  if (!h || !showsHsPrep(school)) return null;
  const rows = unitRows(h);
  const completion = completionSentence(h);
  const prep = collegePrepSentence(h);
  const req = h.units_required;
  const rec = h.units_recommended;
  const showReq = rows.some((r) => r.required !== null);
  const showRec = rows.some((r) => r.recommended !== null);
  return (
    <Block
      id={id}
      title={
        <>
          What you&apos;ll need in high school <InfoTip term="college-preparatory-program" cited={cite("reported.admissions_hs_prep.college_prep", school)} />
        </>
      }
    >
      <div className="space-y-1 text-sm">
        {completion && (
          <p>
            <MetricLabel cited={cite("reported.admissions_hs_prep.completion", school)}>{completion}</MetricLabel>
          </p>
        )}
        {prep && (
          <p>
            <MetricLabel cited={cite("reported.admissions_hs_prep.college_prep", school)}>{prep}</MetricLabel>
          </p>
        )}
      </div>
      <table className="mt-4 w-full max-w-md text-sm">
        <caption className="sr-only">Years of each high school subject</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-medium">Years of</th>
            {showReq && (
              <th className="py-1.5 text-right font-medium">
                <MetricLabel cited={cite("reported.admissions_hs_prep.units_required", school)}>Required</MetricLabel>
              </th>
            )}
            {showRec && (
              <th className="py-1.5 text-right font-medium">
                <MetricLabel cited={cite("reported.admissions_hs_prep.units_recommended", school)}>Recommended</MetricLabel>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-dashed last:border-0">
              <td className="py-1.5">
                {r.label}
                {r.lab && <span className="text-xs text-muted-foreground"> (lab: {[showReq && units(r.lab.required), showRec && units(r.lab.recommended)].filter(Boolean).join(" / ")})</span>}
              </td>
              {showReq && <td className="py-1.5 text-right tabular-nums">{units(r.required)}</td>}
              {showRec && <td className="py-1.5 text-right tabular-nums">{units(r.recommended)}</td>}
            </tr>
          ))}
          <tr className="border-t font-semibold">
            <td className="py-1.5">Total</td>
            {showReq && <td className="py-1.5 text-right tabular-nums">{units(req?.total ?? null)}{req?.total_summed && "*"}</td>}
            {showRec && <td className="py-1.5 text-right tabular-nums">{units(rec?.total ?? null)}{rec?.total_summed && "*"}</td>}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        A unit is a year of the subject; lab science is part of science.
        {(req?.total_summed || rec?.total_summed) && " *Added up from the subjects listed; the college didn't give a total."}
      </p>
    </Block>
  );
}
