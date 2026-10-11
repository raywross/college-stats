import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { collegePrepSentence, completionSentence, showsHsPrep, unitRows } from "@/lib/cds/application-logistics-display";
import { Block } from "@/components/profile/Panel";
import { InfoTip, MetricLabel } from "@/components/ui/info-tip";
import { HsPrepTable } from "./HsPrepTable";

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
      <HsPrepTable
        rows={rows}
        showReq={showReq}
        showRec={showRec}
        required={{ total: req?.total ?? null, summed: !!req?.total_summed }}
        recommended={{ total: rec?.total ?? null, summed: !!rec?.total_summed }}
        citedRequired={cite("reported.admissions_hs_prep.units_required", school)}
        citedRecommended={cite("reported.admissions_hs_prep.units_recommended", school)}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        A unit is a year of the subject; lab science is part of science.
        {(req?.total_summed || rec?.total_summed) && " *Added up from the subjects listed; the college didn't give a total."}
      </p>
    </Block>
  );
}
