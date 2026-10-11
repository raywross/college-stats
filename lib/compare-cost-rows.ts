/**
 * The three Compare rows the cost-by-income work adds to Cost & aid (specs/product/cost-by-income.md "Compare"):
 * "Need-based aid up to", "Merit for students without need", and "Published promise". Like the CDS aid rows
 * (lib/cds/financial-aid-compare.ts) they take a parameter, so the topic page and the table page build them at
 * render time: `showEstimates` is the accuracy pilot's gate (`estimatesShown()`, server-side), and the promise row
 * includes the award year on the topic page, where nothing else adds it (the table adds a cell's own year itself).
 *
 * Pure: relative `.ts` imports only, so tests load it directly.
 */
import type { FieldPath } from "./fields";
import type { School } from "./types";
import type { CompareRow } from "./compare-topics.ts";
import { aidPolicyFor, aidYearLabel } from "./aid-policies.ts";
import { costCurve, costCurveInput } from "./cost-curve.ts";
import { meritFor } from "./merit.ts";
import { breakPointText, meritText, promiseText } from "./cost-at-income.ts";

export const BREAK_POINT_LABEL = "Need-based aid up to";
export const MERIT_LABEL = "Merit for students without need";
export const PROMISE_LABEL = "Published promise";

export function costByIncomeRows(showEstimates: boolean, { withYear = true }: { withYear?: boolean } = {}): readonly CompareRow[] {
  return [
    [BREAK_POINT_LABEL, "break-point", "derived.need_aid_break_income", (s: School) => breakPointText(costCurve(costCurveInput(s)), showEstimates)],
    [
      MERIT_LABEL,
      "merit-aid",
      "derived.merit_class",
      // The IPEDS proxy cell cites derived.merit_proxy; the row's ⓘ names the class, which cites it as an input.
      (s: School) => meritText(meritFor(s)),
    ],
    [
      PROMISE_LABEL,
      "need-based-aid",
      "aid_policy.free_tuition_under",
      (s: School) => {
        const text = promiseText(costCurve(costCurveInput(s)));
        const policy = aidPolicyFor(s.unit_id);
        return text && policy && withYear ? `${text} · ${aidYearLabel(policy.as_of)}` : text;
      },
    ],
  ];
}

/** The fields the rows cite (for the page's source footnote), independent of the gate. */
export const COST_BY_INCOME_FIELDS: readonly FieldPath[] = [
  "derived.need_aid_break_income",
  "derived.need_aid_status",
  "derived.cost_estimate",
  "derived.merit_class",
  "derived.merit_proxy",
  "aid_policy.free_tuition_under",
  "aid_policy.no_contribution_under",
];
