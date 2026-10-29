import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import { Block } from "@/components/profile/Panel";
import { EssayPrompts } from "@/components/school/EssayPrompts";
import { coalitionSentence } from "@/lib/coalition";
import { essayCardLine } from "@/lib/essays/summary";
import { MetricLabel } from "@/components/ui/info-tip";
import { POLICY_LABELS } from "@/lib/test-policy";
import { cycleLabel, feeSentence, materialsLines, newestRegularDeadline, recommendationsSentence, roundLines, testPolicySentence } from "@/lib/common-app/display";
import type { MaterialLine } from "@/lib/common-app/display";

/** `apply.*` field each `MaterialLine.key` reads from (lib/common-app/display.ts `materialsLines`). */
const MATERIAL_FIELD: Record<MaterialLine["key"], FieldPath> = {
  essay: "apply.essay_required",
  writing_supplement: "apply.writing_supplement",
  courses_grades: "apply.courses_grades_required",
  portfolio: "apply.portfolio",
};

/**
 * "What it takes to apply" (common-app-build/brief.md "U2"): the Common App Requirements Grid's own card — rounds
 * offered, fee and fee-waiver, materials required, recommendations, and test policy — reconciled with the college's
 * own Common Data Set where the two disagree (`newestRegularDeadline`). Renders nothing for a non-member, or a member
 * with no grid row (`school.apply?.deadlines` null either way). No "Common App" badge: the words appear only in the
 * sentences where they're the fact (the fee waiver, the personal essay).
 */
export function WhatItTakes({ school, cite, id }: { school: School; cite: (path: FieldPath, school?: School) => Cited; id?: string }) {
  const apply = school.apply;
  if (!apply?.deadlines) return null;

  const deadlinesCited = cite("apply.deadlines", school);
  const today = new Date().toISOString().slice(0, 10);
  const cycle = cycleLabel(apply.common_app.cycle, today);
  const cycleSentence = cycle ? `${cycle.charAt(0).toUpperCase()}${cycle.slice(1)}'s requirements.` : "Requirements.";

  const rounds = roundLines(apply);
  const fee = feeSentence(apply);
  const materials = materialsLines(apply);
  const recommendations = recommendationsSentence(apply);
  const siteLabel = school.admissions.test_policy ? POLICY_LABELS[school.admissions.test_policy] : null;
  const testPolicy = siteLabel ? testPolicySentence(apply, siteLabel) : null;

  const regularCited = cite("reported.admissions_logistics.regular_closing", school);
  // Coalition application (specs/data-expansion/coalition-app.md "Display"): one line, only for a college on Scoir's list.
  const coalition = coalitionSentence(school);
  const reconciled = newestRegularDeadline(apply, school.reported?.admissions_logistics);
  const essayLine = essayCardLine(school.essays);

  return (
    <Block id={id} title="What it takes to apply">
      <p className="-mt-3 mb-3 text-sm text-muted-foreground">
        <MetricLabel cited={deadlinesCited}>{cycleSentence}</MetricLabel>
      </p>
      {rounds.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {rounds.map((r) => (
            <li key={r.key}>
              <MetricLabel cited={deadlinesCited}>
                <span className="font-semibold">{r.label}</span> {r.dateText}
              </MetricLabel>
            </li>
          ))}
        </ul>
      )}
      {reconciled?.winner === "grid" && reconciled.loserText && (
        <p className="mb-3 text-xs text-muted-foreground">
          <MetricLabel cited={regularCited}>{`Its Common Data Set listed ${reconciled.loserText} for the regular round.`}</MetricLabel>
        </p>
      )}
      <div className="space-y-1.5 text-sm">
        {fee && (
          <p>
            <MetricLabel cited={cite("apply.fee", school)}>{fee}</MetricLabel>
          </p>
        )}
        {materials.map((m) => (
          <p key={m.key}>
            <MetricLabel term={m.term} cited={cite(MATERIAL_FIELD[m.key], school)}>
              {m.text}
            </MetricLabel>
          </p>
        ))}
        {recommendations && (
          <p>
            <MetricLabel cited={cite("apply.recommendations", school)}>{recommendations}</MetricLabel>
          </p>
        )}
        {coalition && (
          <p>
            <MetricLabel term="coalition-application" cited={cite("coalition.via_scoir", school)}>
              {coalition}
            </MetricLabel>
          </p>
        )}
        {testPolicy && (
          <p>
            <MetricLabel cited={cite("apply.test_policy", school)}>{testPolicy}</MetricLabel>
          </p>
        )}
      </div>
      {/* Essay prompts (specs/product/essays/prompts.md "Display"): the card line, opening a fold of every prompt. */}
      {essayLine && (
        <div className="mt-3 border-t pt-3">
          <EssayPrompts school={school} cite={cite} />
        </div>
      )}
    </Block>
  );
}
