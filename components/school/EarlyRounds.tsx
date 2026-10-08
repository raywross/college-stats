import { getData } from "@/lib/data";
import { admissionProfile, edRate, monthDayLabel, sameDocumentRate } from "@/lib/cds/admissions";
import { DOMAINS } from "@/lib/metrics";
import { num, pctSmart } from "@/lib/format";
import type { MonthDayValue, School } from "@/lib/types";
import { Block } from "@/components/profile/Panel";
import { MetricLabel } from "@/components/ui/info-tip";
import { OnYourPlan } from "@/components/planner/OnYourPlan";

const dates = (closing: MonthDayValue | null, notification: MonthDayValue | null) =>
  [closing && `apply by ${monthDayLabel(closing)}`, notification && `decisions by ${monthDayLabel(notification)}`].filter(Boolean).join("; ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Applying early" (specs/data-expansion/cds-admissions.md, Display 2): early decision with its rate beside the same
 * class's overall rate (from the same CDS document only), the dates as the edition publishes them, the standing ED
 * caveat, and early action. Hidden when the CDS says nothing about either plan, or neither is offered without an
 * explicit No for both.
 */
export async function EarlyRounds({ school, id }: { school: School; id?: string }) {
  const p = admissionProfile(school);
  const ed = p?.early_decision;
  const ea = p?.early_action;
  if (!ed && !ea) return null;
  const { citeField } = await getData();
  const cite = (leaf: string) => citeField(`reported.admission_profile.${leaf}` as Parameters<typeof citeField>[0], school);
  const neither = ed?.offered === false && ea?.offered === false;
  if (!neither && !ed?.offered && !ea?.offered) return null;
  const rate = edRate(ed);
  const overall = rate !== null ? sameDocumentRate(school) : null;

  return (
    <Block id={id} title="Applying early">
      {neither ? (
        <p className="text-sm text-muted-foreground">
          <MetricLabel term="early-decision" cited={cite("early_decision.offered")}>
            Doesn&apos;t offer early decision or early action
          </MetricLabel>
        </p>
      ) : (
        <div className="space-y-4">
          {ed?.offered && (
            <div>
              {rate !== null ? (
                <>
                  <p className="font-display text-lg font-bold">
                    <MetricLabel term="early-decision" cited={citeField("derived.ed_admit_rate", school)}>
                      Early decision: <span style={{ color: DOMAINS.admissions.color }}>{pctSmart(rate)}</span> admitted
                    </MetricLabel>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                    <MetricLabel cited={cite("early_decision.admitted")}>
                      {num(ed.admitted!)} of {num(ed.applicants!)} early applicants
                      {overall !== null && `; ${pctSmart(overall)} of all applicants`}
                    </MetricLabel>
                  </p>
                </>
              ) : (
                <p className="text-sm">
                  <MetricLabel term="early-decision" cited={cite("early_decision.offered")}>
                    Offers early decision. The college doesn&apos;t publish how many apply or are admitted early.
                  </MetricLabel>
                </p>
              )}
              {ed.first && (ed.first.closing || ed.first.notification) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  <MetricLabel cited={cite(ed.first.closing ? "early_decision.first.closing" : "early_decision.first.notification")}>
                    {cap(dates(ed.first.closing, ed.first.notification))}
                  </MetricLabel>
                </p>
              )}
              {ed.other && (ed.other.closing || ed.other.notification) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  <MetricLabel cited={cite(ed.other.closing ? "early_decision.other.closing" : "early_decision.other.notification")}>
                    Second round: {dates(ed.other.closing, ed.other.notification)}
                  </MetricLabel>
                </p>
              )}
              {/* Always under the ED figures, never in a tooltip. */}
              <p className="mt-2 max-w-2xl text-sm">
                Early decision is binding: if admitted, you commit to enroll. Recruited athletes and other applicants with an edge often apply early, so the early
                rate overstates the gain for a typical applicant.
              </p>
            </div>
          )}
          {ea?.offered && (
            <div className="space-y-1 text-sm">
              <p>
                <MetricLabel term={ea.restrictive ? "restrictive-early-action" : "early-action"} cited={cite("early_action.offered")}>
                  {ea.restrictive ? "Restrictive early action" : "Early action"} (not binding)
                  {(ea.closing || ea.notification) && `: ${dates(ea.closing, ea.notification)}`}
                </MetricLabel>
              </p>
              {ea.restrictive && (
                <p className="text-muted-foreground">Restrictive early action: applicants agree not to apply to other colleges&apos; early plans, with exceptions the college sets.</p>
              )}
            </div>
          )}
          {ed?.offered === false && ea?.offered && <p className="text-sm text-muted-foreground">No early decision plan.</p>}
          {ea?.offered === false && ed?.offered && <p className="text-sm text-muted-foreground">No early action plan.</p>}
          {/* The planner's line for a signed-in student with this college on their list (early-rounds.md "Display"). */}
          <OnYourPlan unitId={school.unit_id} />
        </div>
      )}
    </Block>
  );
}
