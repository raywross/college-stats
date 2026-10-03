import type { Cited } from "@/lib/lineage";
import type { ReportedTestPolicy, TestPolicy } from "@/lib/types";
import { lineageFall } from "@/lib/score-bands";
import { POLICY_HEADLINES, variesText } from "@/lib/test-policy";
import { MetricLabel, SourceTip } from "@/components/ui/info-tip";

const NOTE_SHOWN = 200;

/**
 * "Test policy", the first block of the admissions page's Test scores panel (specs/data-expansion/
 * cds-test-scores-and-policy.md, Display): the newest policy's headline and one sentence. The year comes from lineage:
 * a college's CDS states it for students entering in a coming fall; federal data for students who already entered.
 */
export function TestPolicyBlock({
  policy,
  reported,
  note,
  cited,
  noteCited,
}: {
  /** `admissions.test_policy`: the newest policy (Decision 1). */
  policy: TestPolicy | undefined;
  /** `reported.test_policy`, for "varies by test" when the grid's rows differ. */
  reported: ReportedTestPolicy | null | undefined;
  /** C8F, quoted for "required for some". */
  note: string | null | undefined;
  cited: Cited;
  noteCited?: Cited;
}) {
  const fromCds = cited.key === "college-site";
  const varies = !policy && reported && !reported.policy && (reported.sat_only || reported.act_only);
  if (!policy && !varies) return null;
  const fall = lineageFall(cited.year);
  const when = fall === null ? null : fromCds ? `For students entering in fall ${fall}` : `For students who entered in fall ${fall}`;
  const words = policy ? POLICY_HEADLINES[policy] : { headline: "Varies by test", sentence: variesText(reported!) };
  return (
    <div>
      <MetricLabel term="test-policy" cited={cited} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Test policy
      </MetricLabel>
      <p className="mt-1 font-display text-xl font-extrabold">{words.headline}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {words.sentence}
        {when && ` ${when}.`}
      </p>
      {policy === "required-some" && note && (
        <blockquote className="mt-2 flex items-start gap-1 border-l-2 pl-2 text-sm italic text-muted-foreground">
          “{note.length <= NOTE_SHOWN ? note : `${note.slice(0, NOTE_SHOWN - 1)}…`}”{noteCited && <SourceTip cited={noteCited} />}
        </blockquote>
      )}
    </div>
  );
}
