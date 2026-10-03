import type { School } from "@/lib/types";
import type { SchoolDetail } from "@/lib/detail";
import { getData } from "@/lib/data";
import { cdsAidYearNote } from "@/lib/cds/financial-aid";
import { money, num } from "@/lib/format";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { BLOCK_SCROLL } from "@/components/profile/Panel";

/**
 * Cost page, "International students" (#international-aid; specs/data-expansion/cds-financial-aid.md#display): what
 * the college gives nonresidents from its own funds (H6, dated by its aid year) and the forms they file (H7). Federal
 * data has nothing on this.
 */
export async function InternationalAid({ school, detail }: { school: School; detail: SchoolDetail | null }) {
  const aid = school.reported?.aid;
  const intl = aid?.international ?? null;
  const h7 = detail?.tables.cds_aid?.rows.h7 ?? null;
  const { citeField } = await getData();
  // H6 follows the aid year rule: not shown when two or more years older than the federal aid figures.
  const showH6 = !!intl && cdsAidYearNote(aid?.aid_year ?? null, citeField("aid.cohort", school).year).show;
  if (!showH6 && !h7) return null;
  const cited = citeField("reported.aid.international", school);

  const types = intl ? [intl.need_based && "Need-based", intl.non_need && "merit"].filter(Boolean) : [];
  const forms = h7 ? [h7.css_profile && "the CSS Profile", h7.own_form && "the college's own form", h7.other && (h7.other_text ?? "another form")].filter(Boolean) as string[] : [];

  return (
    <div id="international-aid" className={`mt-6 rounded-3xl border bg-card p-4 sm:p-6 ${BLOCK_SCROLL}`}>
      <h3 className="font-display text-lg font-bold">International students</h3>
      <div className="mt-3 space-y-2 text-sm">
        {showH6 && intl && (
          <MetricLabel term="aid-for-international-students" cited={cited}>
            <span>
              {intl.none ? (
                <>The college doesn&apos;t offer its own grants to international students.</>
              ) : intl.recipients !== null && intl.average !== null ? (
                <>
                  <b>{num(intl.recipients)}</b> international students received an average of <b>{money(intl.average)}</b> from the college in {cited.year}.
                </>
              ) : (
                <>The college offered its own aid to international students in {cited.year}.</>
              )}
            </span>
          </MetricLabel>
        )}
        {showH6 && intl && !intl.none && types.length > 0 && <p className="text-muted-foreground">{types.length === 2 ? "Need-based and merit aid offered." : `${types[0] === "merit" ? "Merit" : types[0]} aid offered.`}</p>}
        {forms.length > 0 && (
          <p className="text-muted-foreground">
            International applicants file: {forms.join(", ")}
            {h7?.css_profile && (
              <>
                {" "}
                (<Term term="css-profile">what&apos;s this?</Term>)
              </>
            )}
            .
          </p>
        )}
      </div>
    </div>
  );
}
